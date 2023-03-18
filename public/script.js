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
    game.fill();
  });

  socket.on("server:update", (data) => {
    game.history = data.history;
    game.fill();
  });

  // handle drawing events from other clients
  socket.on("server:draw", (data) => game.stream(data));

  socket.on("server:undo", () => game.undo());

  // handle a reset event
  socket.on("server:reset", () => {
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
    game.undo();
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

      game.fill();
    },
    false
  );

  // undo the last line drawn
  undoButton.addEventListener("click", () => {
    game.undo();
    game.update(true);
  });

  // clear the screen
  clearButton.addEventListener("click", () => {
    game.history = [];
    game.clear();
    game.update(true);
  });

  canvas.addEventListener("mousedown", (e) => {
    // account for the canvas offsets
    const x = e.offsetX - game.canvas.offsetLeft;
    const y = e.offsetY - game.canvas.offsetTop;

    // update cursor
    game.cursor.putDown(x, y);
  });

  canvas.addEventListener("mousemove", (e) => {
    // account for the canvas offsets
    const x = e.offsetX - game.canvas.offsetLeft;
    const y = e.offsetY - game.canvas.offsetTop;

    // draw on the canvas
    game.cursor.draw(x, y);

    // update other clients
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

class CanvasEvent {
  constructor(type) {
    this.type = type;
  }
}

class DrawEvent extends CanvasEvent {
  constructor(color, width, points) {
    super("draw");
    this.color = color;
    this.width = width;
    this.points = points;
  }
}

class ImageEvent extends CanvasEvent {
  constructor(image) {
    super("image");
    this.image = image;
  }
}

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
    this.clients = {};
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
    e.preventDefault();
    // get item from clipboard
    const item = e.clipboardData.items[0];

    // create image html element
    const img = new Image();

    img.onload = () => {
      // draw the image on the canvas
      this.context.drawImage(img, 0, 0);

      // draw the image on other client's canvas
      this.update(true);
    };

    // only support images
    if (item.type.indexOf("image") === 0) {
      const blob = item.getAsFile();
      const reader = new FileReader();

      reader.onload = (event) => {
        const dataUrl = event.target.result;
        // set the image source and trigger the onload event
        img.src = dataUrl;

        // add the image event to the history array
        this.history.push(new ImageEvent(dataUrl));
      };

      reader.readAsDataURL(blob);
    }
  }

  update(force = false) {
    this.socket.emit("client:update", {
      history: this.history,
      roomId: this.roomId,
      force,
    });
  }

  stream(data) {
    let cursor = this.clients[data.socketId];

    if (!cursor) {
      cursor = this.clients[data.socketId] = new Pen(this);
    }

    cursor.setWidth(data.width);
    cursor.setColor(data.color);
    cursor.isDown = data.isDown;

    if (!data.isDown) {
      if (cursor.points.length) {
        this.history.push(
          new DrawEvent(cursor.color, cursor.width, cursor.points)
        );
        cursor.points = [];
      }

      // keep track of the last cursor position
      cursor.x = data.x;
      cursor.y = data.y;
      return;
    }
    cursor.draw(data.x, data.y);
  }

  fill() {
    this.clear();
    // redraw everything
    this.history.forEach((event) => {
      const { type, points: paths, color, width } = event;
      if (type === "draw") {
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.lineCap = this.cursor.lineCap;
        let currentPath = paths[0];

        for (let i = 1; i < paths.length; i++) {
          this.context.beginPath();
          this.context.moveTo(currentPath.x, currentPath.y);
          currentPath = paths[i];
          this.context.lineTo(currentPath.x, currentPath.y);
          this.context.stroke();
          this.context.closePath();
        }
      } else if (type === "image") {
        const img = new Image();
        img.src = event.image;

        img.onload = () => {
          this.context.drawImage(img, 0, 0);
        };
      }
    });
  }

  undo(numSteps = 1) {
    // remove the last specified strokes
    this.history.splice(this.history.length - Math.max(0, numSteps), numSteps);

    this.fill();
  }
}

class Pen {
  constructor(game) {
    // keep track of game object to append events onto the history array
    this.game = game;
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
      this.game.history.push(
        new DrawEvent(this.color, this.width, this.points)
      );
      this.game.update();
    }
  }

  putDown(x, y) {
    this.points = [];
    this.x = x;
    this.y = y;
    this.points.push({ x: this.x, y: this.y });
    this.isDown = true;
  }

  draw(x, y) {
    if (!this.isDown) return;
    this.game.context.lineCap = this.lineCap;
    this.game.context.strokeStyle = this.color;
    this.game.context.lineWidth = this.width;
    this.game.context.beginPath();
    this.game.context.moveTo(this.x, this.y);
    this.x = x;
    this.y = y;
    this.points.push({ x: this.x, y: this.y });
    this.game.context.lineTo(this.x, this.y);
    this.game.context.stroke();
  }
}
