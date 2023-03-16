document.addEventListener("DOMContentLoaded", function () {
  const CANVAS_MARGIN = 20;
  const canvas = document.getElementById("canvas");
  canvas.height = 800;
  canvas.width = window.innerWidth - CANVAS_MARGIN;
  const penColor = document.querySelector('input[name="penColor"]');
  const penWidth = document.querySelector('input[name="penWidth"]');
  const saveButton = document.getElementById("saver");
  const undoButton = document.getElementById("undo");
  const clearButton = document.getElementById("clear");

  const socket = io();

  let roomId = new URL(window.location.href).searchParams.get("roomId");

  const game = new Game(canvas, socket, roomId);
  game.cursor.setWidth(penWidth.value);
  game.cursor.setColor(penColor.value);

  // send an event to join a room when first connecting
  socket.emit("room:join", { roomId }, (data) => {
    // when we successfully join a room, get the history from the server and update the canvas
    game.history = data.history;
    game.cursor.fill();
  });

  // handle drawing events from other clients
  socket.on("server:draw", function (data) {
    // only handle other clients
    if (data.id === socket.id) return;

    let currentClient = game.clients[data.id];

    if (!currentClient) {
      currentClient = game.clients[data.id] = new Pen(game, data.id);
    }

    currentClient.stream(data);
  });

  socket.on("server:undo", (data) => {
    if (data.id === socket.id) return;

    let currentClient = game.clients[data.id];

    if (!currentClient) return;

    currentClient.undo();
  });

  // handle a reset event
  socket.on("server:reset", (data) => {
    if (data.id === socket.id) return;
    game.history = [];
    game.clear();
  });

  penWidth.addEventListener("change", (e) =>
    game.cursor.setWidth(e.target.value)
  );

  penColor.addEventListener("change", (e) =>
    game.cursor.setColor(e.target.value)
  );

  // download and image of the drawing in it's current state when this is clicked
  saveButton.addEventListener("click", function (e) {
    // get the image from the canvas
    const image = game.canvas.toDataURL("image/png");

    // download the image using an a tag
    const a = document.createElement("a");
    a.setAttribute("download", "image.png");
    a.setAttribute("href", image.replace("image/png", "image/octet-stream"));
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    // remove the a tag after the image has been downloaded
    document.body.removeChild(a);
  });

  // handle resizing the canvas
  window.addEventListener(
    "resize",
    () => {
      const newWidth = window.innerWidth - CANVAS_MARGIN;
      canvas.width = newWidth;
      game.width = newWidth;

      game.cursor.fill();
    },
    false
  );

  // undo the last line drawn
  undoButton.addEventListener("click", () => {
    game.cursor.undo();
    socket.emit("client:undo", { roomId: game.roomId, steps: 1 });
  });

  // clear the screen
  clearButton.addEventListener("click", () => {
    game.history = [];
    game.clear();
    socket.emit("client:reset", { roomId: game.roomId });
  });

  canvas.addEventListener("mousedown", (e) => {
    game.cursor.putDown(e.offsetX, e.offsetY);
  });

  canvas.addEventListener("mousemove", (e) => {
    game.cursor.draw(e.offsetX, e.offsetY);
    socket.emit("client:draw", {
      x: e.offsetX,
      y: e.offsetY,
      color: game.cursor.color,
      width: game.cursor.width,
      isDown: game.cursor.isDown,
      roomId,
    });
  });

  canvas.addEventListener("mouseup", () => game.cursor.pickUp());
  canvas.addEventListener("mouseout", () => game.cursor.pickUp());
});

class Game {
  constructor(canvas, socket, roomId) {
    this.roomId = roomId;
    this.clients = {};
    this.canvas = canvas;
    this.socket = socket;
    this.context = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.cursor = new Pen(this);
    this.history = [];
  }

  clear() {
    this.context.clearRect(0, 0, this.width, this.height);
  }
}

class Pen {
  constructor(game, socketId = null) {
    this.game = game;
    this.socketId = socketId;
    // default values
    this.x = 0;
    this.y = 0;
    this.width = 5;
    this.lineCap = "round";
    this.color = "#000000";
    this.isDown = false;
    this.points = [];
  }

  setColor(color) {
    this.color = color;
  }

  setWidth(width) {
    this.width = width;
  }

  pickUp() {
    if (this.isDown) {
      this.isDown = false;
      if (!this.points.length) return;

      this.game.history.push({
        points: this.points,
        color: this.color,
        width: this.width,
      });

      this.game.socket.emit("history:update", {
        history: this.game.history,
        roomId: this.game.roomId,
      });
    }
  }

  putDown(x, y) {
    this.points = [];
    this.getPosition(x, y);
    this.points.push({ x: this.x, y: this.y });
    this.isDown = true;
  }

  getPosition(x, y) {
    this.x = x - this.game.canvas.offsetLeft;
    this.y = y - this.game.canvas.offsetTop;
  }

  draw(x, y) {
    if (!this.isDown) return;
    this.game.context.lineCap = this.lineCap;
    this.game.context.strokeStyle = this.color;
    this.game.context.lineWidth = this.width;
    this.game.context.beginPath();
    this.game.context.moveTo(this.x, this.y);
    this.getPosition(x, y);
    this.points.push({ x: this.x, y: this.y });
    this.game.context.lineTo(this.x, this.y);
    this.game.context.stroke();
  }

  stream(data) {
    this.width = data.width;
    this.color = data.color;
    if (!data.isDown) {
      if (this.points.length) {
        this.game.history.push({
          points: this.points,
          color: this.color,
          width: this.width,
        });
        this.points = [];
      }

      // keep track of the last cursor position
      this.x = data.x;
      this.y = data.y;
      return;
    }

    this.game.context.lineCap = this.lineCap;
    this.game.context.strokeStyle = this.color;
    this.game.context.lineWidth = this.width;
    this.game.context.beginPath();
    this.game.context.moveTo(this.x, this.y);
    this.x = data.x;
    this.y = data.y;
    this.points.push({ x: this.x, y: this.y });
    this.game.context.lineTo(this.x, this.y);
    this.game.context.stroke();
    this.game.context.closePath();
  }

  undo(numSteps = 1) {
    // remove the last specified strokes
    this.game.history.splice(
      this.game.history.length - Math.max(0, numSteps),
      numSteps
    );

    this.fill();
  }

  fill() {
    this.game.clear();
    // redraw everything
    this.game.history.forEach(({ points: paths, color, width }) => {
      this.game.context.strokeStyle = color;
      this.game.context.lineWidth = width;
      this.game.context.lineCap = this.lineCap;
      let currentPath = paths[0];

      for (let i = 1; i < paths.length; i++) {
        this.game.context.beginPath();
        this.game.context.moveTo(currentPath.x, currentPath.y);
        currentPath = paths[i];
        this.game.context.lineTo(currentPath.x, currentPath.y);
        this.game.context.stroke();
        this.game.context.closePath();
      }
    });
  }
}
