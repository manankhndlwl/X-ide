const http = require("http");
const express = require("express");
const { Server: SocketServer } = require("socket.io");
const fs = require("fs/promises");
const cors = require("cors");
const app = express();
const path = require("path");
const server = http.createServer(app);
const chokidar = require("chokidar");

require("dotenv").config();

const pty = require("node-pty");

app.use(cors());

const ptyProcess = pty.spawn("bash", [], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: process.env.INIT_CWD + "/user",
  env: process.env,
});
console.log("🚀 ~ ptyProcess:", ptyProcess);

const io = new SocketServer({
  cors: "*",
});

io.attach(server);

chokidar.watch("./user").on("all", (event, path) => {
  io.emit("file:refresh", path);
});

// for sending data to frontend from terminal
ptyProcess.onData((data) => {
  console.log("🚀 ~ ptyProcess.onData ~ data:", data);
  io.emit("terminal:data", data);
});

io.on("connection", (socket) => {
  console.log("Socket connected", socket.id);

  socket.emit("file:refresh");

  socket.on("file:change", async ({ path, content }) => {
    await fs.writeFile(`./user${path}`, content);
  });

  // handling terminal input from frontend
  socket.on("terminal:write", (data) => {
    console.log("Term", data);
    ptyProcess.write(data);
  });
});

app.get("/files", async (req, res) => {
  const fileTree = await generateFileTree("./user");
  return res.json({ tree: fileTree });
});

app.get("/files/content", async (req, res) => {
  const path = req.query.path;
  const content = await fs.readFile(`./user${path}`, "utf-8");
  return res.json({ content });
});

server.listen(process.env.PORT || 9000, () => {
  console.log(`DOCKER container is running at port ${process.env.PORT}`);
});

async function generateFileTree(directory) {
  const tree = {};

  async function buildTree(currentDir, currentTree) {
    const files = await fs.readdir(currentDir);
    for (const file of files) {
      const filePath = path.join(currentDir, file);

      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        currentTree[file] = {};
        await buildTree(filePath, currentTree[file]);
      } else {
        currentTree[file] = null;
      }
    }
  }

  await buildTree(directory, tree);
  return tree;
}
