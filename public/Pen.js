import { EventType } from "./lib.js";

// TODO: this shouldn't be kept here. There should be a seperate interface that manages the tool options
export const ToolType = {
  DRAW: "1",
  RECTANGLE: "2",
  COLOR_PICKER: "3",
};

export default class Pen {
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

  pickUp(x, y) {
    if (this.isDown) {
      this.isDown = false;

      // TODO: the pen tool shouldn't care about the tool that's currently selected.
      // move this logic elsewhere
      if (this.game.toolId == ToolType.DRAW) {
        if (!this.points.length) return;
        this.game.append(EventType.DRAW, this);
        this.game.update();
      } else if (this.game.toolId == ToolType.RECTANGLE) {
        this.drawRectangle(x, y);
        this.game.append(EventType.DRAW_RECTANGLE, {
          color: this.color,
          startX: this.x,
          startY: this.y,
          endX: x - this.x,
          endY: y - this.y,
        });
        this.game.update(true);
      }
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
    if (!this.isDown) {
      this.x = x;
      this.y = y;
      return;
    }
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

  // TODO: there should be a seperate interface for drawing rectangles and other shapes.
  drawRectangle(x, y) {
    if (!this.isDown) return;
    this.game.fill();
    const endX = x - this.x;
    const endY = y - this.y;
    this.game.context.fillStyle = this.color;
    this.game.context.fillRect(this.x, this.y, endX, endY);
  }

  // TODO: there should be a seperate interface for the color picker tool
  pickColor(x, y) {
    if (!this.isDown) return;
    const [r, g, b, a] = this.game.context.getImageData(x, y, 1, 1).data;

    const color = "#" + [r, g, b].map(componentToHex).join("");

    // TODO: implement alpha so that we can draw slightly transparent images
    const alpha = componentToHex(a) / 255;

    this.setColor(color);

    return color;
  }
}

function componentToHex(c) {
  var hex = c.toString(16);
  return hex.length == 1 ? "0" + hex : hex;
}
