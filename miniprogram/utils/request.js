const { API_BASE, ASSET_BASE } = require('../config');

function request({ url, method = 'GET', data = {}, header = {} }) {
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.reLaunch({ url: '/pages/login/index' });
          reject(new Error(body.msg || '请重新登录'));
          return;
        }
        if (body.code !== 0) {
          reject(new Error(body.msg || '请求失败'));
          return;
        }
        resolve(body.data);
      },
      fail: reject,
    });
  });
}

function upload(filePath) {
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE}/mini/upload`,
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        const body = JSON.parse(res.data || '{}');
        if (body.code !== 0) {
          reject(new Error(body.msg || '上传失败'));
          return;
        }
        resolve(body.data.url);
      },
      fail: reject,
    });
  });
}

function asset(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${ASSET_BASE}${url}`;
}

module.exports = { request, upload, asset };
