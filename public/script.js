import Game from "./Game.js";
import { ToolType } from "./Pen.js";

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
  const toolSelect = document.getElementById("tool-select");

  const socket = io();

  let roomId = new URL(window.location.href).searchParams.get("roomId");

  const game = new Game(canvas, socket, roomId);

  // set the initial cursor color
  const color = localStorage.getItem("color") || penColor.value;
  game.cursor.setColor(color);
  penColor.value = color;

  // set the initial cursor width
  const width = localStorage.getItem("width") || penWidth.value;
  game.cursor.setWidth(width);
  penWidth.value = width;

  // set the initial tool selection
  const toolId = localStorage.getItem("tool") || toolSelect.value;
  game.selectTool(toolId);
  toolSelect.value = toolId;

  // send an event to join a room when first connecting
  socket.emit("room:join", { roomId }, (data) => {
    // when we successfully join a room, get the history from the server and update the canvas
    game.history.set(data.history);
    game.fill();
  });

  socket.on("server:update", (data) => {
    game.history.set(data.history);
    game.fill();
  });

  // handle drawing events from other clients
  socket.on("server:draw", (data) => game.stream(data));

  socket.on("server:undo", () => game.undo());

  // handle a reset event
  socket.on("server:reset", () => {
    game.reset();
  });

  penWidth.addEventListener("change", (e) => {
    localStorage.setItem("width", e.target.value);
    game.cursor.setWidth(e.target.value);
  });

  penColor.addEventListener("change", (e) => {
    localStorage.setItem("color", e.target.value);
    game.cursor.setColor(e.target.value);
  });

  toolSelect.addEventListener("change", (e) => {
    localStorage.setItem("tool", e.target.value);
    game.selectTool(e.target.value);
  });

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

  // handle redo using keyboard
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.key !== "y") return;
    game.redo();
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
    game.reset();
    game.update(true);
  });

  function getMouseCoordinates(canvas, mouseEvent) {
    const x = mouseEvent.offsetX - canvas.offsetLeft;
    const y = mouseEvent.offsetY - canvas.offsetTop;
    return [x, y];
  }

  canvas.addEventListener("mousedown", (e) => {
    const [x, y] = getMouseCoordinates(game.canvas, e);

    // update cursor
    game.cursor.putDown(x, y);
  });

  const handleDraw = (e) => {
    const [x, y] = getMouseCoordinates(game.canvas, e);

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
  };

  const handleDrawSquare = (e) => {
    const [x, y] = getMouseCoordinates(game.canvas, e);

    // draw square on canvas
    game.cursor.drawRectangle(x, y);
  };

  canvas.addEventListener("mousemove", (e) => {
    switch (game.toolId) {
      case ToolType.DRAW:
        handleDraw(e);
        break;
      case ToolType.RECTANGLE:
        handleDrawSquare(e);
        break;
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    const [x, y] = getMouseCoordinates(game.canvas, e);
    game.cursor.pickUp(x, y);
  });

  canvas.addEventListener("mouseout", (e) => {
    const [x, y] = getMouseCoordinates(game.canvas, e);
    game.cursor.pickUp(x, y);
  });
});
