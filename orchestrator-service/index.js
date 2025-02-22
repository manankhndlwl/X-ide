// ecs-orchestrator.js
const express = require("express");
const {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
} = require("@aws-sdk/client-ecs");
const app = express();
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const {
  EC2Client,
  DescribeNetworkInterfacesCommand,
} = require("@aws-sdk/client-ec2");

app.use(express.json());

dotenv.config();

// Initialize ECS client
const ecs = new ECSClient({ region: process.env.AWS_REGION });
// initialize ec2 client
const ec2Client = new EC2Client({ region: "ap-south-1" });

// Store task info for each user
const userTasks = new Map();

// Configuration for different environments
const environments = {
  golang: {
    taskDefinition: "golang-ide:3",
    containerName: "golang-ide:latest",
  },
};

async function launchTask(userId, environment) {
  const config = environments[environment];
  if (!config) throw new Error(`Unsupported environment: ${environment}`);

  // Launch ECS task
  const runTaskCommand = new RunTaskCommand({
    cluster: process.env.ECS_CLUSTER,
    taskDefinition: config.taskDefinition,
    launchType: "FARGATE",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SUBNET_IDS.split(","),
        securityGroups: [process.env.SECURITY_GROUP_ID],
        assignPublicIp: "ENABLED",
      },
    },
    tags: [
      { key: "userId", value: userId },
      { key: "environment", value: environment },
    ],
  });

  const response = await ecs.send(runTaskCommand);
  const task = response.tasks[0];

  // Wait for task to be running and get container info
  const taskInfo = await waitForTask(task.taskArn);

  // Get the public IP from the ENI attachment
  const eniId = taskInfo?.attachments[0]?.details.find(
    (d) => d.name === "networkInterfaceId"
  )?.value;

  if (!eniId) throw new Error("ENI ID not found!");

  // Step 2: Get Public IP from ENI ID
  const eniDetails = await ec2Client.send(
    new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] })
  );

  const publicIp = eniDetails.NetworkInterfaces[0]?.Association?.PublicIp;

  if (!publicIp) {
    throw new Error(
      "No public IP found for task - check subnet and VPC configuration"
    );
  }

  // For Fargate tasks, we use the container port defined in the task definition

  const containerPort = 9000;

  return {
    taskArn: task.taskArn,
    url: `http://${publicIp}:${containerPort}`,
  };
}

async function waitForTask(taskArn) {
  while (true) {
    const describeCommand = new DescribeTasksCommand({
      cluster: process.env.ECS_CLUSTER,
      tasks: [taskArn],
    });

    const response = await ecs.send(describeCommand);
    const task = response.tasks[0];

    if (task.lastStatus === "RUNNING") {
      return task;
    } else if (task.lastStatus === "STOPPED") {
      throw new Error("Task failed to start");
    }

    // Wait before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function stopTask(taskArn) {
  const command = new StopTaskCommand({
    cluster: process.env.ECS_CLUSTER,
    task: taskArn,
    reason: "User session ended",
  });

  await ecs.send(command);
}

// Middleware to verify user token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Routes
app.post("/environments", async (req, res) => {
  try {
    const { environment } = req.body;
    const userId = "1";

    // Clean up existing task if any
    if (userTasks.has(userId)) {
      await stopTask(userTasks.get(userId).taskArn);
    }

    const taskInfo = await launchTask(userId, environment);
    userTasks.set(userId, taskInfo);

    res.json({
      message: "Environment created successfully",
      containerUrl: taskInfo.url,
    });
  } catch (error) {
    console.error("Environment creation failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/environments", async (req, res) => {
  try {
    const userId = "1";
    if (userTasks.has(userId)) {
      await stopTask(userTasks.get(userId).taskArn);
      userTasks.delete(userId);
    }
    res.json({ message: "Environment removed successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ECS orchestrator running on port ${PORT}`);
});
