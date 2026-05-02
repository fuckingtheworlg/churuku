Component({
  data: {
    drawing: false,
    hasSign: false,
    lastX: 0,
    lastY: 0,
  },
  lifetimes: {
    ready() {
      this.ctx = wx.createCanvasContext('signatureCanvas', this);
      this.ctx.setStrokeStyle('#111827');
      this.ctx.setLineWidth(3);
      this.ctx.setLineCap('round');
      this.ctx.setLineJoin('round');
    },
  },
  methods: {
    start(e) {
      const point = e.touches[0];
      this.setData({ drawing: true, hasSign: true, lastX: point.x, lastY: point.y });
    },
    move(e) {
      if (!this.data.drawing) return;
      const point = e.touches[0];
      this.ctx.moveTo(this.data.lastX, this.data.lastY);
      this.ctx.lineTo(point.x, point.y);
      this.ctx.stroke();
      this.ctx.draw(true);
      this.setData({ lastX: point.x, lastY: point.y });
    },
    clear() {
      this.ctx.clearRect(0, 0, 800, 300);
      this.ctx.draw();
      this.setData({ hasSign: false });
    },
    exportImage() {
      if (!this.data.hasSign) return Promise.resolve('');
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath(
          {
            canvasId: 'signatureCanvas',
            fileType: 'png',
            success: (res) => resolve(res.tempFilePath),
            fail: reject,
          },
          this,
        );
      });
    },
  },
});
