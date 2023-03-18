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

  pickUp() {
    if (this.isDown) {
      this.isDown = false;
      if (!this.points.length) return;
      this.game.append("draw", this);
      // this.game.history.push(
      //   new DrawEvent(this.color, this.width, this.points)
      // );
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
