const { API_BASE, ASSET_BASE } = require('../config');

function request({ url, method = 'GET', data = {}, header = {}, timeout = 30000 }) {
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${url}`,
      method,
      data,
      timeout,
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
        if (typeof body !== 'object' || body.code === undefined) {
          reject(new Error(`服务器返回异常（HTTP ${res.statusCode || '?'}）`));
          return;
        }
        if (body.code !== 0) {
          reject(new Error(body.msg || '请求失败'));
          return;
        }
        resolve(body.data);
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '网络请求失败'));
      },
    });
  });
}

function parseUploadResponse(raw, statusCode) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (!text) return null;
  if (text[0] !== '{' && text[0] !== '[') {
    const snippet = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`服务器返回非 JSON（HTTP ${statusCode || '?'}）：${snippet}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`响应解析失败：${error.message || error}`);
  }
}

function upload(filePath) {
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE}/mini/upload`,
      filePath,
      name: 'file',
      timeout: 120000,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        try {
          const body = parseUploadResponse(res.data, res.statusCode);
          if (!body) {
            reject(new Error(`上传失败：服务器返回为空（HTTP ${res.statusCode || '?'}）`));
            return;
          }
          if (res.statusCode === 413 || body.code === 413) {
            reject(new Error('图片过大，请等待自动压缩或选择较小的图片'));
            return;
          }
          if (body.code !== 0) {
            reject(new Error(body.msg || `上传失败（HTTP ${res.statusCode || '?'}）`));
            return;
          }
          if (!body.data || !body.data.url) {
            reject(new Error('上传成功但未返回文件地址'));
            return;
          }
          resolve(body.data.url);
        } catch (error) {
          reject(error);
        }
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '网络上传失败'));
      },
    });
  });
}

function asset(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${ASSET_BASE}${url}`;
}

module.exports = { request, upload, asset };
