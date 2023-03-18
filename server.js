const http = require("http");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// keep track of each room's history here so that it can be sent to the client as needed
const rooms = {};

// make sure that the roomId parameter exists as it is what identifies the drawing session
app.use((req, res, next) => {
  if (req.path === "/") {
    // only handle root path
    let roomId = req.query.roomId;

    if (!roomId) {
      roomId = crypto.randomUUID();
      rooms[roomId] = {
        history: {
          position: 0,
          events: [],
        },
      };
      return res.redirect(url.parse(req.url).pathname + `?roomId=${roomId}`);
    }

    if (roomId && !rooms[roomId]) {
      return res.redirect(url.parse(req.url).pathname);
    }
  }

  next();
});

// serve the public files to the public
// the root path will automatically use index.html
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  // TODO: clean up unused room history
  socket.on("disconnect", () => {});

  socket.on("room:join", (data, callback) => {
    socket.join(data.roomId);
    const history = rooms[data.roomId].history;
    callback({ history });
  });

  socket.on("client:update", (data) => {
    const currentRoom = rooms[data.roomId];
    if (!currentRoom) return; // don't crash the server

    currentRoom.history = data.history;

    if (!data.force) return;
    socket.to(data.roomId).emit("server:update", data);
  });

  socket.on("client:draw", (data) => {
    socket.to(data.roomId).emit("server:draw", data);
  });
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
