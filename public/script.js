import Game from "./Game.js";

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

  // handle undo using keyboard
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.key !== "z") return;
    game.undo();
    game.update(true);
  });

  // override default copy
  document.addEventListener("copy", (e) => {
    e.preventDefault();
    game.copy();
  });

  // override default paste
  document.addEventListener("paste", (e) => {
    e.preventDefault();
    const item = e.clipboardData.items[0];
    game.paste(item);
  });

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
