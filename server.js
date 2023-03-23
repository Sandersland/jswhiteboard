const http = require("http");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { Server: SocketServer } = require("socket.io");
const { MongoClient } = require("mongodb");

// use .env files for settings and credentials
require("dotenv").config();

const debounce = require("./debounce");

// use the port set in the .env file if provided, otherwise default to port 3000
const PORT = process.env.PORT || 3000;

// initialize express server and security middlewares
const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(helmet());

// initialize a socket.io server
const io = new SocketServer(server);
const mongoClient = new MongoClient(process.env.MONGO_URI);

// keep track of each room's history here so that it can be sent to the client as needed
let historyCollection;

// the action happens on the /draw url
app.get("/", (_, res) => res.redirect("/draw"));

// serve the public files to the public
// the root path will automatically use index.html
app.use(express.static(path.join(__dirname, "public")));

// serve the whiteboard endpoint
app.get("/draw", async (req, res) => {
  let roomId = req.query.roomId;
  let result;

  // make sure that the roomId parameter exists as it is what identifies the drawing session
  if (!roomId) {
    // generate a uuid that will be used as the unique room identifier
    roomId = crypto.randomUUID();

    // insert an event record
    result = await historyCollection.insertOne({
      _id: roomId,
      position: 0,
      events: [],
    });

    // redirect with the newly generated roomId to be used in the client
    return res.redirect(url.parse(req.url).pathname + `?roomId=${roomId}`);
  }

  // handle the case where the roomId was provided but doesn't exist or isn't valid
  if (roomId && !result) {
    result = await historyCollection.findOne({ _id: req.query.roomId });
    // drop the roomId and redirect if the room specified doesn't exist
    if (!result) {
      return res.redirect(url.parse(req.url).pathname);
    }
  }

  // serve index.html
  const options = {
    root: path.join(__dirname, "public"),
  };

  res.sendFile("index.html", options);
});

// socket io events
io.on("connection", (socket) => {
  // find the room that is joined and respond with the room history
  socket.on("room:join", async (data, callback) => {
    let result = await historyCollection.findOne({ _id: data.roomId });

    socket.join(data.roomId);
    // set the room Id to be used for other events
    socket.roomId = data.roomId;
    callback({ history: result });
  });

  // update the database with the current history
  socket.on(
    "client:update",
    // debounce updating mongodb to reduce number of updates
    debounce(async (data) => {
      await historyCollection.updateOne(
        { _id: socket.roomId },
        {
          $set: {
            events: data.history.events,
            position: data.history.position,
          },
        }
      );

      // if the 'force' parameter is true then forward this event to other clients
      if (!data.force) return;
      socket.to(socket.roomId).emit("server:update", data);
    })
  );

  // handle streaming draw events
  socket.on("client:draw", (data) => {
    socket.to(socket.roomId).emit("server:draw", data);
  });
});

// start the server and listen for requests
server.listen(PORT, async () => {
  try {
    // attempt to connect to mongodb
    await mongoClient.connect();

    // set a global reference to the history collection
    historyCollection = mongoClient.db("jswhiteboard").collection("history");

    console.log("Listening on port %s...", server.address().port);
  } catch (e) {
    console.error(e);
  }
});
