const http = require("http");
const express = require("express");
const { Server: SocketServer } = require("socket.io");

const app = express();
const server = http.createServer(app);

require("dotenv").config();

const pty = require("node-pty");

const ptyProcess = pty.spawn("bash", [], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: process.env.INIT_CWD,
  env: process.env,
});

const io = new SocketServer({
  cors: "*",
});

io.attach(server);

// for sending data to frontend from terminal
ptyProcess.onData((data) => {
  io.emit("terminal:data", data);
});

io.on("connection", (socket) => {
  console.log("Socket connected", socket.id);
  // handling terminal input from frontend
  socket.on("terminal:write", (data) => {
    console.log("Term", data);
    ptyProcess.write(data);
  });
});

server.listen(process.env.PORT, () => {
  console.log(`DOCKER container is running at port ${process.env.PORT}`);
});
