const { request } = require('../../utils/request');

Page({
  data: { loading: false },
  async login() {
    this.setData({ loading: true });
    try {
      const loginRes = await wx.login();
      const res = await request({
        url: '/auth/wx-login',
        method: 'POST',
        data: { code: loginRes.code },
      });
      if (res.status === 'unregistered') {
        wx.navigateTo({ url: '/pages/register/index' });
      } else if (res.status === 'pending') {
        wx.reLaunch({ url: '/pages/pending/index' });
      } else if (res.status === 'disabled') {
        wx.showModal({ title: '账号已禁用', content: '请联系管理员处理。', showCancel: false });
      } else {
        wx.setStorageSync('token', res.token);
        wx.setStorageSync('user', res.user);
        getApp().globalData.token = res.token;
        getApp().globalData.user = res.user;
        wx.switchTab({ url: '/pages/index/index' });
      }
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
