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
  let roomId = req.query.roomId;

  if (!roomId) {
    roomId = crypto.randomUUID();
    rooms[roomId] = {
      history: [],
    };
    return res.redirect(url.parse(req.url).pathname + `?roomId=${roomId}`);
  }

  if (roomId && !rooms[roomId]) {
    return res.redirect(url.parse(req.url).pathname);
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

  socket.on("history:update", (data) => {
    rooms[data.roomId].history = data.history;
  });

  socket.on("client:reset", (data) => {
    rooms[data.roomId].history = [];
    socket.to(data.roomId).emit("server:reset", { id: socket.id });
  });

  socket.on("client:draw", (data) => {
    socket.to(data.roomId).emit("server:draw", { id: socket.id, ...data });
  });

  socket.on("client:undo", (data) => {
    const room = rooms[data.roomId];
    room.history.splice(
      room.history.length - Math.max(0, data.steps),
      data.steps
    );
    socket.to(data.roomId).emit("server:undo", { id: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
