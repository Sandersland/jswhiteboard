import Pen from "./Pen.js";
import { EventType } from "./lib.js";

class CanvasEvent {
  constructor(type) {
    this.type = type;
  }
}

export class DrawEvent extends CanvasEvent {
  constructor(color, width, points) {
    super(EventType.DRAW);
    this.color = color;
    this.width = width;
    this.points = points;
  }
}

export class DrawRectangleEvent extends CanvasEvent {
  constructor(color, startX, startY, endX, endY) {
    super(EventType.DRAW_RECTANGLE);
    this.color = color;
    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
  }
}

export class ImageEvent extends CanvasEvent {
  constructor(image) {
    super(EventType.IMAGE);
    this.image = image;
  }
}

export class ResetEvent extends CanvasEvent {
  constructor() {
    super(EventType.RESET);
  }
}

class EventCache {
  constructor() {
    this.position = 0;
    this.events = [];
  }

  set({ events, position }) {
    this.events = events;
    this.position = position;
  }

  add(event) {
    if (!event) return;

    if (this.position <= this.events.length) {
      this.events = this.events.slice(0, this.position);
    }

    this.events.push(event);

    this.position += 1;
  }

  undo() {
    if (this.position > 0) {
      this.position -= 1;
    }
  }

  redo() {
    if (this.position < this.events.length) {
      this.position += 1;
    }
  }
}

export default class Game {
  constructor(canvas, socket, roomId) {
    this.canvas = canvas;
    this.roomId = roomId;
    this.socket = socket;
    this.context = canvas.getContext("2d", {
      willReadFrequently: true,
    });
    this.width = canvas.width;
    this.height = canvas.height;
    this.cursor = new Pen(this);
    this.history = new EventCache();
    this.clients = {};
    this.toolId = "1"; // default to Draw for now
    this.imgCache = {};
  }

  selectTool(toolId) {
    this.toolId = toolId;
  }

  reset() {
    this.append(EventType.RESET);
    this.clear();
  }

  // generic interface used to add events to the stack
  append(type, data) {
    let event;
    switch (type) {
      case EventType.DRAW:
        event = new DrawEvent(data.color, data.width, data.points);
        break;
      case EventType.IMAGE:
        event = new ImageEvent(data);
        break;
      case EventType.RESET:
        event = new ResetEvent();
        break;
      case EventType.DRAW_RECTANGLE:
        event = new DrawRectangleEvent(
          data.color,
          data.startX,
          data.startY,
          data.endX,
          data.endY
        );
        break;
    }
    this.history.add(event);
  }

  clear() {
    // simply clear the entire canvas
    this.context.clearRect(0, 0, this.width, this.height);
  }

  copy() {
    // get the image from the canvas
    this.canvas.toBlob((blob) => {
      // add the image to the clipboard
      const item = new ClipboardItem({ "image/png": blob });
      navigator.clipboard.write([item]);
    });
  }

  paste(item) {
    // create image html element
    const img = new Image();

    img.onload = () => {
      // draw the image on the canvas
      this.context.drawImage(img, 0, 0);

      // cache the image to prevent flickering when the canvas is re-rendered
      this.imgCache[img.src] = img;

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
        this.append(EventType.IMAGE, dataUrl);
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
    let clientCursor = this.clients[data.socketId];

    if (!clientCursor) {
      clientCursor = this.clients[data.socketId] = new Pen(this);
    }

    clientCursor.setWidth(data.width);
    clientCursor.setColor(data.color);
    clientCursor.isDown = data.isDown;

    if (!data.isDown) {
      if (clientCursor.points.length) {
        this.append(EventType.DRAW, clientCursor);
        clientCursor.points = [];
      }

      // always keep track of the last cursor position
      clientCursor.x = data.x;
      clientCursor.y = data.y;
      return;
    }
    clientCursor.draw(data.x, data.y);
  }

  async fill() {
    this.clear();
    // redraw everything
    for (let i = 0; i < this.history.events.length; i++) {
      if (i >= this.history.position) continue;
      const event = this.history.events[i];

      if (event.type === EventType.DRAW) {
        const { points: paths, color, width } = event;
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
      } else if (event.type === EventType.IMAGE) {
        // check to see if this image has been cached
        let img = this.imgCache[event.image];

        if (!img) {
          // if the image hasn't been cached, load it then cache it
          img = await loadImage(event.image);
          this.imgCache[event.image] = img;
        }

        // draw the image
        this.context.drawImage(img, 0, 0);
      } else if (event.type === EventType.RESET) {
        this.context.clearRect(0, 0, this.width, this.height);
      } else if (event.type === EventType.DRAW_RECTANGLE) {
        const { startX, startY, endX, endY, color } = event;
        this.context.fillStyle = color;
        this.context.fillRect(startX, startY, endX, endY);
      }
    }
  }

  undo() {
    this.history.undo();
    this.fill();
  }

  redo() {
    this.history.redo();
    this.fill();
  }
}

async function loadImage(url, elem = new Image()) {
  return new Promise((resolve, reject) => {
    elem.onload = () => resolve(elem);
    elem.onerror = reject;
    elem.src = url;
  });
}
