document.addEventListener("DOMContentLoaded", function () {
  const CANVAS_MARGIN = 20;
  const canvas = document.getElementById("canvas");
  canvas.height = 800;
  canvas.width = window.innerWidth - CANVAS_MARGIN;
  const penColor = document.querySelector('input[name="penColor"]');
  const penWidth = document.querySelector('input[name="penWidth"]');
  const downloadButton = document.getElementById("download");
  const undoButton = document.getElementById("undo");
  const clearButton = document.getElementById("reset");

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

  socket.on("server:update", (data) => {
    game.history = data.history;
    game.cursor.fill();
  });

  // handle drawing events from other clients
  socket.on("server:draw", (data) => game.cursor.stream(data));

  socket.on("server:undo", () => game.cursor.undo());

  // handle a reset event
  socket.on("server:reset", (data) => {
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
  downloadButton.addEventListener("click", function (e) {
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

  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.key !== "z") return;
    game.cursor.undo();
    game.update(true);
  });

  document.addEventListener("copy", (e) => game.copy(e));

  document.addEventListener("paste", (e) => game.paste(e));

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
  undoButton.addEventListener("click", () => game.undo());

  // clear the screen
  clearButton.addEventListener("click", () => {
    game.history = [];
    game.clear();
    game.update(true);
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

  copy(e) {
    e.preventDefault();
    this.canvas.toBlob((blob) => {
      const item = new ClipboardItem({ "image/png": blob });
      navigator.clipboard.write([item]);
    });
  }

  paste(e) {
    // TODO: this should be added to history somehow
    e.preventDefault();
    // get item from clipboard
    const item = e.clipboardData.items[0];

    const img = new Image();
    img.onload = () => {
      this.context.drawImage(img, 0, 0);
      this.update(true);
    };

    if (item.type.indexOf("image") === 0) {
      const blob = item.getAsFile();
      const reader = new FileReader();

      reader.onload = (event) => {
        img.src = event.target.result;
        this.history.push({ type: "image", image: event.target.result });
      };

      reader.readAsDataURL(blob);
    }
  }

  undo() {
    this.cursor.undo();
    this.update(true);
  }

  update(force = false) {
    this.socket.emit("client:update", {
      history: this.history,
      roomId: this.roomId,
      force,
    });
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
        type: "draw",
        points: this.points,
        color: this.color,
        width: this.width,
      });

      this.game.update();
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
          type: "draw",
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
    this.game.history.forEach((event) => {
      const { type, points: paths, color, width } = event;
      if (type === "draw") {
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
      } else if (type === "image") {
        const img = new Image();
        img.src = event.image;

        img.onload = () => {
          this.game.context.drawImage(img, 0, 0);
        };
      }
    });
  }
}
