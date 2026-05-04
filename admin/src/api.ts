import axios from 'axios';

export const request: any = axios.create({ baseURL: '/api', timeout: 20000 });

request.interceptors.request.use((config: any) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

request.interceptors.response.use(
  (res: any) => {
    if (res.data?.code && res.data.code !== 0) {
      return Promise.reject(new Error(res.data.msg || '请求失败'));
    }
    return res.data.data;
  },
  (error: any) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.reload();
    }
    return Promise.reject(new Error(error.response?.data?.msg || error.message));
  },
);

export interface Dept {
  id: number;
  name: string;
  code: string;
}

export interface AdminAccount {
  id: number;
  username: string;
  role: 'super' | 'dept';
  deptId?: number;
  dept?: Dept;
  mustChangePassword?: boolean;
  createdAt?: string;
}

export interface GlobalCategory {
  id: number;
  name: string;
  sort: number;
  usedCount?: number;
}

export interface Item {
  id: number;
  deptId: number;
  categoryId?: number;
  name: string;
  spec?: string;
  unit: string;
  location?: string;
  quantity: number;
  note?: string;
  image?: string;
  dept?: Dept;
  category?: { id: number; name: string };
}

export interface User {
  id: number;
  realName: string;
  nickname?: string;
  dept?: Dept;
  status: 'pending' | 'active' | 'disabled';
  createdAt: string;
}

export interface StockRecord {
  id: number;
  type: 'in' | 'out';
  projectName?: string;
  quantity: number;
  itemSummary?: string;
  items?: Array<{ id: number; itemId: number; quantity: number; item?: Item }>;
  operatorName?: string;
  latitude?: string;
  longitude?: string;
  address?: string;
  poiName?: string;
  photos?: string[];
  signatureUrl?: string;
  occurredAt: string;
  note?: string;
  dept?: Dept;
  item?: Item;
}

export const api = {
  adminLogin: (data: { username: string; password: string }) => request.post('/auth/admin-login', data),
  adminMe: () => request.get('/auth/admin-me'),
  changePassword: (data: { oldPassword: string; newPassword: string }) => request.patch('/auth/password', data),
  dashboard: () => request.get('/dashboard'),
  depts: () => request.get('/dept'),
  admins: () => request.get('/admin'),
  saveAdmin: (data: Record<string, unknown>, id?: number) =>
    id ? request.patch(`/admin/${id}`, data) : request.post('/admin', data),
  deleteAdmin: (id: number) => request.delete(`/admin/${id}`),
  globalCategories: () => request.get('/global-item-category'),
  saveGlobalCategory: (data: Record<string, unknown>, id?: number) =>
    id ? request.patch(`/global-item-category/${id}`, data) : request.post('/global-item-category', data),
  deleteGlobalCategory: (id: number, force = false) => request.delete(`/global-item-category/${id}`, { params: { force } }),
  createDept: (data: Partial<Dept>) => request.post('/dept', data),
  updateDept: (id: number, data: Partial<Dept>) => request.patch(`/dept/${id}`, data),
  deleteDept: (id: number, force = false) => request.delete(`/dept/${id}`, { params: { force } }),
  users: (params: Record<string, unknown>) => request.get('/user', { params }),
  updateUserStatus: (id: number, status: User['status']) => request.patch(`/user/${id}/status`, { status }),
  deleteUser: (id: number) => request.delete(`/user/${id}`),
  categories: (deptId?: number) => request.get('/item-category', { params: { deptId } }),
  saveCategory: (data: Record<string, unknown>, id?: number) =>
    id ? request.patch(`/item-category/${id}`, data) : request.post('/item-category', data),
  deleteCategory: (id: number, force = false) => request.delete(`/item-category/${id}`, { params: { force } }),
  items: (params: Record<string, unknown>) => request.get('/item', { params }),
  saveItem: (data: Record<string, unknown>, id?: number) =>
    id ? request.patch(`/item/${id}`, data) : request.post('/item', data),
  deleteItem: (id: number, force = false) => request.delete(`/item/${id}`, { params: { force } }),
  records: (params: Record<string, unknown>) => request.get('/stock-record', { params }),
  upload: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request.post('/upload', body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
