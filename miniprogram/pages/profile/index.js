const { request } = require('../../utils/request');

Page({
  data: {
    user: {},
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const res = await request({ url: '/auth/me' });
      this.setData({ user: res.user || wx.getStorageSync('user') || {} });
    } catch (error) {
      this.setData({ user: wx.getStorageSync('user') || {} });
    }
  },
  logout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
    wx.reLaunch({ url: '/pages/login/index' });
  },
});
