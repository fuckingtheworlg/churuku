<template>
  <div v-if="!token" class="login-wrap">
    <el-card class="login-card">
      <h2>Churuku 管理后台</h2>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="账号">
          <el-input v-model="loginForm.username" autocomplete="off" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="loginForm.password" type="password" show-password autocomplete="off" />
        </el-form-item>
        <el-checkbox v-model="rememberMe" style="margin-bottom:12px">记住密码（仅建议在私人专用电脑上勾选）</el-checkbox>
        <el-button type="primary" class="full" :loading="loading" @click="login">登录</el-button>
      </el-form>
    </el-card>
  </div>
  <el-container v-else class="shell">
    <el-aside width="220px" class="aside">
      <h2>Churuku</h2>
      <el-menu :default-active="active" @select="onMenuSelect">
        <el-menu-item index="dashboard">仪表盘</el-menu-item>
        <el-menu-item v-if="isSuperAdmin" index="dept">部门</el-menu-item>
        <el-menu-item v-if="isSuperAdmin" index="admin">部门后台账号</el-menu-item>
        <el-menu-item v-if="isSuperAdmin" index="globalCategory">总物品分类</el-menu-item>
        <el-menu-item index="user">用户审批</el-menu-item>
        <el-menu-item index="category">库存类目</el-menu-item>
        <el-menu-item index="item">物品库存</el-menu-item>
        <el-menu-item index="record">出入库记录</el-menu-item>
        <el-menu-item index="password">修改密码</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span>{{ titleMap[active] }}</span>
        <span class="muted">{{ currentAdmin?.role === 'dept' ? currentAdmin.dept?.name || '部门后台' : '超级管理员' }}</span>
        <el-button link type="danger" @click="logout">退出</el-button>
      </el-header>
      <el-main>
        <el-alert
          v-if="mustChangePassword"
          type="warning"
          show-icon
          :closable="false"
          title="为安全考虑，首次登录请先修改密码后再使用其他功能。"
          style="margin-bottom:16px"
        />
        <Dashboard v-if="active === 'dashboard'" />
        <DeptPage v-else-if="active === 'dept'" :is-super="isSuperAdmin" @changed="refreshOptions" />
        <AdminPage v-else-if="active === 'admin'" :depts="depts" />
        <GlobalCategoryPage v-else-if="active === 'globalCategory'" />
        <UserPage v-else-if="active === 'user'" :depts="depts" />
        <CategoryPage v-else-if="active === 'category'" :depts="depts" :is-super="isSuperAdmin" />
        <ItemPage v-else-if="active === 'item'" :depts="depts" :is-super="isSuperAdmin" />
        <RecordPage v-else-if="active === 'record'" :depts="depts" />
        <PasswordPage v-else :force="mustChangePassword" @changed="onPasswordChanged" />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue';
import { AdminAccount, api, Dept, GlobalCategory, Item, StockRecord, User } from './api';

const token = ref(localStorage.getItem('admin_token') || '');
const loading = ref(false);
const active = ref('dashboard');
const depts = ref<Dept[]>([]);
const currentAdmin = ref<AdminAccount | null>(null);
const isSuperAdmin = computed(() => currentAdmin.value?.role === 'super');
const mustChangePassword = computed(() => !!currentAdmin.value?.mustChangePassword);
const REMEMBER_KEY = 'admin_login_remember';
const savedLogin = (() => {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null') as
      | { username: string; password: string }
      | null;
  } catch {
    return null;
  }
})();
const rememberMe = ref(!!savedLogin);
const loginForm = reactive({
  username: savedLogin?.username || '',
  password: savedLogin?.password || '',
});
const titleMap: Record<string, string> = {
  dashboard: '仪表盘',
  dept: '部门管理',
  admin: '部门后台账号',
  globalCategory: '总物品分类',
  user: '用户审批',
  category: '库存类目',
  item: '物品库存',
  record: '出入库记录',
  password: '修改密码',
};

async function login() {
  if (!loginForm.username || !loginForm.password) {
    return ElMessage.warning('请输入账号和密码');
  }
  loading.value = true;
  try {
    const res: any = await api.adminLogin(loginForm);
    localStorage.setItem('admin_token', res.token);
    if (rememberMe.value) {
      localStorage.setItem(
        REMEMBER_KEY,
        JSON.stringify({ username: loginForm.username, password: loginForm.password }),
      );
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
    currentAdmin.value = res.user;
    token.value = res.token;
    active.value = res.user?.mustChangePassword ? 'password' : 'dashboard';
    if (!rememberMe.value) loginForm.password = '';
    await refreshOptions();
  } catch (error: any) {
    ElMessage.error(error?.message || '登录失败，请检查账号或密码');
  } finally {
    loading.value = false;
  }
}

function logout() {
  localStorage.removeItem('admin_token');
  currentAdmin.value = null;
  token.value = '';
  active.value = 'dashboard';
}

async function refreshOptions() {
  if (!token.value) return;
  try {
    const me: any = await api.adminMe();
    currentAdmin.value = me.user;
  } catch (error: any) {
    ElMessage.error(error?.message || '登录已失效，请重新登录');
    logout();
    return;
  }
  if (currentAdmin.value?.mustChangePassword) {
    active.value = 'password';
  } else if (currentAdmin.value?.role === 'dept' && ['dept', 'admin', 'globalCategory'].includes(active.value)) {
    active.value = 'dashboard';
  }
  try {
    depts.value = await api.depts();
  } catch (error) {
    depts.value = [];
  }
}

function onMenuSelect(key: string) {
  if (mustChangePassword.value && key !== 'password') {
    ElMessage.warning('请先修改初始密码后再操作其他功能');
    active.value = 'password';
    return;
  }
  active.value = key;
}

function onPasswordChanged() {
  if (currentAdmin.value) {
    currentAdmin.value = { ...currentAdmin.value, mustChangePassword: false };
  }
  refreshOptions();
}

onMounted(refreshOptions);

const Dashboard = defineComponent({
  setup() {
    const data = ref({ deptCount: 0, userPending: 0, itemCount: 0, recordCount: 0 });
    onMounted(async () => (data.value = await api.dashboard()));
    return () =>
      h('div', { class: 'grid' }, [
        h('div', { class: 'stat' }, [h('b', data.value.deptCount), h('span', '部门')]),
        h('div', { class: 'stat' }, [h('b', data.value.userPending), h('span', '待审批')]),
        h('div', { class: 'stat' }, [h('b', data.value.itemCount), h('span', '物品')]),
        h('div', { class: 'stat' }, [h('b', data.value.recordCount), h('span', '出入库记录')]),
      ]);
  },
});

function uniqueTextOptions(values: Array<string | undefined | null>, preset: string[] = []) {
  return Array.from(
    new Set(
      [...preset, ...values]
        .map((item) => (item || '').trim())
        .filter(Boolean),
    ),
  );
}

const DeptPage = defineComponent({
  props: { isSuper: { type: Boolean, default: false } },
  emits: ['changed'],
  setup(props, { emit }) {
    const list = ref<Dept[]>([]);
    const form = reactive({ id: 0, name: '', code: '' });
    async function load() {
      list.value = await api.depts();
      emit('changed');
    }
    async function save() {
      if (!form.name || !form.code) return ElMessage.warning('请填写部门名称和编码');
      form.id ? await api.updateDept(form.id, form) : await api.createDept(form);
      Object.assign(form, { id: 0, name: '', code: '' });
      ElMessage.success('已保存');
      await load();
    }
    async function remove(row: Dept) {
      await ElMessageBox.confirm(`确定删除部门 ${row.name}？仅空部门可删除。`);
      await api.deleteDept(row.id);
      await load();
    }
    async function forceRemove(row: Dept) {
      await ElMessageBox.confirm(
        `强制删除部门 ${row.name} 会删除该部门下人员、分类、物品和历史流水，无法恢复。确认继续？`,
        '危险操作',
        { type: 'warning' },
      );
      await api.deleteDept(row.id, true);
      await load();
    }
    onMounted(load);
    return { props, list, form, save, remove, forceRemove };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-input v-model="form.name" placeholder="部门名称" style="width:180px" />
        <el-input v-model="form.code" placeholder="编码" style="width:160px" />
        <el-button type="primary" @click="save">{{ form.id ? '更新' : '新增' }}</el-button>
        <el-button @click="Object.assign(form,{id:0,name:'',code:''})">清空</el-button>
      </div>
      <el-table :data="list">
        <el-table-column prop="name" label="部门" />
        <el-table-column prop="code" label="编码" />
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="Object.assign(form,row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
            <el-button v-if="props.isSuper" link type="danger" @click="forceRemove(row)">强制删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>`,
});

const AdminPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true } },
  setup(props) {
    const list = ref<AdminAccount[]>([]);
    const form = reactive<any>({ id: 0, username: '', password: '', role: 'dept', deptId: undefined });
    async function load() {
      list.value = await api.admins();
    }
    async function save() {
      if (!form.username) return ElMessage.warning('请填写账号');
      if (form.role === 'dept' && !form.deptId) return ElMessage.warning('请选择绑定部门');
      if (!form.id && !form.password) return ElMessage.warning('请填写初始密码');
      const roleText = form.role === 'super' ? '超级管理员' : '部门管理员';
      await ElMessageBox.confirm(
        `${form.id ? '更新' : '新增'}后台账号 ${form.username}，角色为${roleText}。确认继续？`,
        '账号权限确认',
        { type: 'warning' },
      );
      await api.saveAdmin({ username: form.username, password: form.password || undefined, role: form.role, deptId: form.deptId }, form.id || undefined);
      Object.assign(form, { id: 0, username: '', password: '', role: 'dept', deptId: undefined });
      ElMessage.success('账号已保存');
      await load();
    }
    async function remove(row: AdminAccount) {
      await ElMessageBox.confirm(`确定删除后台账号 ${row.username}？`);
      await api.deleteAdmin(row.id);
      await load();
    }
    function edit(row: AdminAccount) {
      Object.assign(form, { id: row.id, username: row.username, password: '', role: row.role, deptId: row.deptId });
    }
    onMounted(load);
    return { props, list, form, load, save, remove, edit };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-input v-model="form.username" placeholder="后台账号" style="width:180px" />
        <el-input v-model="form.password" placeholder="密码（编辑时不填则不改）" type="password" show-password style="width:220px" />
        <el-select v-model="form.role" placeholder="角色" style="width:150px">
          <el-option label="超级管理员" value="super" />
          <el-option label="部门管理员" value="dept" />
        </el-select>
        <el-select v-if="form.role==='dept'" v-model="form.deptId" filterable clearable placeholder="绑定部门" style="width:200px">
          <el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-button type="primary" @click="save">{{ form.id ? '更新' : '新增' }}</el-button>
        <el-button @click="Object.assign(form,{id:0,username:'',password:'',role:'dept',deptId:undefined})">清空</el-button>
      </div>
      <p class="muted">部门管理员登录后只能看到并管理绑定部门的数据；超级管理员可查看全部部门。</p>
      <el-table :data="list">
        <el-table-column prop="username" label="账号" />
        <el-table-column label="角色"><template #default="{row}">{{ row.role === 'super' ? '超级管理员' : '部门管理员' }}</template></el-table-column>
        <el-table-column label="绑定部门"><template #default="{row}">{{ row.dept?.name || '-' }}</template></el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="edit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>`,
});

const GlobalCategoryPage = defineComponent({
  setup() {
    const list = ref<GlobalCategory[]>([]);
    const form = reactive({ id: 0, name: '', sort: 0 });
    async function load() {
      list.value = await api.globalCategories();
    }
    async function save() {
      if (!form.name) return ElMessage.warning('请填写总分类名称');
      await api.saveGlobalCategory({ name: form.name, sort: form.sort }, form.id || undefined);
      Object.assign(form, { id: 0, name: '', sort: 0 });
      ElMessage.success('总分类已保存');
      await load();
    }
    async function remove(row: GlobalCategory) {
      await ElMessageBox.confirm(`确定删除总分类 ${row.name}？已被部门使用时不允许普通删除。`);
      await api.deleteGlobalCategory(row.id);
      await load();
    }
    async function forceRemove(row: GlobalCategory) {
      await ElMessageBox.confirm(
        `强制删除总分类 ${row.name} 会解除它与部门分类的关联，但不会删除部门分类和物品。确认继续？`,
        '危险操作',
        { type: 'warning' },
      );
      await api.deleteGlobalCategory(row.id, true);
      await load();
    }
    onMounted(load);
    return { list, form, save, remove, forceRemove };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-input v-model="form.name" placeholder="总分类名称" style="width:220px" />
        <el-input-number v-model="form.sort" placeholder="排序" />
        <el-button type="primary" @click="save">{{ form.id ? '更新' : '新增' }}</el-button>
        <el-button @click="Object.assign(form,{id:0,name:'',sort:0})">清空</el-button>
      </div>
      <p class="muted">总分类是模板。部门分类删除不会影响总分类；这里的“使用部门数”用于体现哪些总分类已被部门采用。</p>
      <el-table :data="list">
        <el-table-column prop="name" label="总分类" />
        <el-table-column prop="sort" label="排序" />
        <el-table-column prop="usedCount" label="使用部门数" />
        <el-table-column label="操作" width="240">
          <template #default="{ row }">
            <el-button link type="primary" @click="Object.assign(form,row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
            <el-button link type="danger" @click="forceRemove(row)">强制删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>`,
});

const UserPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true } },
  setup(props) {
    const users = ref<User[]>([]);
    const query = reactive({
      page: 1,
      pageSize: 50,
      keyword: '',
      deptId: undefined as number | undefined,
      status: undefined as User['status'] | undefined,
    });
    async function load() {
      const res: any = await api.users(query);
      users.value = res.list;
    }
    async function setStatus(row: User, status: User['status']) {
      const statusText = status === 'active' ? '通过' : status === 'pending' ? '设为待审' : '禁用';
      await ElMessageBox.confirm(
        `确定将人员 ${row.realName} ${statusText}？该操作会影响其小程序登录和出入库权限。`,
        '人员权限确认',
        { type: 'warning' },
      );
      await api.updateUserStatus(row.id, status);
      ElMessage.success('已更新');
      await load();
    }
    async function remove(row: User) {
      await ElMessageBox.confirm(`确定删除人员 ${row.realName}？历史流水中的责任人姓名会保留。`);
      await api.deleteUser(row.id);
      await load();
    }
    onMounted(load);
    return { props, users, query, load, setStatus, remove, dayjs };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-select v-model="query.deptId" filterable clearable placeholder="部门/仓库" style="width:180px" @change="load" @clear="load">
          <el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-select v-model="query.status" filterable clearable placeholder="审批状态" style="width:150px" @change="load" @clear="load">
          <el-option label="待审批" value="pending" />
          <el-option label="已通过" value="active" />
          <el-option label="已禁用" value="disabled" />
        </el-select>
        <el-input v-model="query.keyword" clearable placeholder="姓名/昵称/部门" style="width:220px" @keyup.enter="load" />
        <el-button @click="load">查询</el-button>
      </div>
      <el-table :data="users">
        <el-table-column prop="realName" label="姓名" />
        <el-table-column prop="nickname" label="昵称" />
        <el-table-column label="部门"><template #default="{row}">{{ row.dept?.name }}</template></el-table-column>
        <el-table-column prop="status" label="状态" />
        <el-table-column label="注册时间"><template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}</template></el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{row}">
            <el-button link type="success" @click="setStatus(row,'active')">通过</el-button>
            <el-button link type="warning" @click="setStatus(row,'pending')">待审</el-button>
            <el-button link type="danger" @click="setStatus(row,'disabled')">禁用</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>`,
});

const CategoryPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true }, isSuper: { type: Boolean, default: false } },
  setup(props) {
    const list = ref<any[]>([]);
    const globalCategories = ref<GlobalCategory[]>([]);
    const form = reactive({ id: 0, deptId: 0, globalCategoryId: undefined as number | undefined, name: '', sort: 0 });
    function ensureDeptSelected() {
      if (!form.deptId && props.depts.length > 0) {
        form.deptId = props.depts[0].id;
      }
    }
    async function load() {
      ensureDeptSelected();
      const [categories, globals] = await Promise.all([
        api.categories(form.deptId || undefined),
        api.globalCategories(),
      ]);
      list.value = categories;
      globalCategories.value = globals;
    }
    function onGlobalCategoryChange() {
      const current = globalCategories.value.find((item) => item.id === form.globalCategoryId);
      if (current) form.name = current.name;
    }
    async function save() {
      if (!props.depts.length) return ElMessage.warning('请先在部门管理中新增部门');
      if (!form.deptId || !form.name) return ElMessage.warning('请选择所属部门/仓库并填写类目名称');
      await api.saveCategory({ deptId: form.deptId, globalCategoryId: form.globalCategoryId, name: form.name, sort: form.sort }, form.id || undefined);
      Object.assign(form, { id: 0, globalCategoryId: undefined, name: '', sort: 0 });
      ElMessage.success('类目已保存');
      await load();
    }
    async function remove(row: any) {
      await ElMessageBox.confirm(`确定删除部门分类 ${row.name}？仅分类下没有物品时可删除，总分类不会被删除。`);
      await api.deleteCategory(row.id);
      await load();
    }
    async function forceRemove(row: any) {
      await ElMessageBox.confirm(
        `强制删除分类 ${row.name} 会删除分类下物品及相关历史流水，无法恢复。确认继续？`,
        '危险操作',
        { type: 'warning' },
      );
      await api.deleteCategory(row.id, true);
      await load();
    }
    watch(
      () => props.depts,
      () => load(),
      { deep: true },
    );
    onMounted(load);
    return { props, list, globalCategories, form, load, save, remove, forceRemove, onGlobalCategoryChange };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <span class="muted">所属部门/仓库</span>
        <el-select v-model="form.deptId" filterable clearable placeholder="请选择该类目所属部门/仓库" style="width:260px" @change="load" @clear="load">
          <el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-select v-model="form.globalCategoryId" filterable clearable placeholder="可选：关联总分类" style="width:220px" @change="onGlobalCategoryChange">
          <el-option v-for="c in globalCategories" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select
          v-model="form.name"
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入类目名称"
          style="width:220px"
        >
          <el-option v-for="c in list" :key="c.id" :label="c.name" :value="c.name" />
        </el-select>
        <el-input-number v-model="form.sort" placeholder="排序" />
        <el-button type="primary" @click="save">保存</el-button>
      </div>
      <p class="muted">说明：库存类目按部门/仓库隔离。选择上面的部门后，新增或编辑的类目只会出现在该部门的物品库存中。</p>
      <el-table :data="list">
        <el-table-column label="部门"><template #default="{row}">{{ row.dept?.name }}</template></el-table-column>
        <el-table-column prop="name" label="类目" />
        <el-table-column label="总分类"><template #default="{row}">{{ row.globalCategory?.name || '-' }}</template></el-table-column>
        <el-table-column prop="sort" label="排序" />
        <el-table-column label="操作"><template #default="{row}">
          <el-button link type="primary" @click="Object.assign(form,{...row,globalCategoryId:row.globalCategoryId})">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
          <el-button v-if="props.isSuper" link type="danger" @click="forceRemove(row)">强制删除</el-button>
        </template></el-table-column>
      </el-table>
    </div>`,
});

const ItemPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true }, isSuper: { type: Boolean, default: false } },
  setup(props) {
    const items = ref<Item[]>([]);
    const categories = ref<any[]>([]);
    const queryCategories = ref<any[]>([]);
    const unitOptions = ref<string[]>([]);
    const specOptions = ref<string[]>([]);
    const locationOptions = ref<string[]>([]);
    const query = reactive({
      page: 1,
      pageSize: 50,
      deptId: undefined as number | undefined,
      categoryId: undefined as number | undefined,
      keyword: '',
    });
    const dialog = ref(false);
    const form = reactive<any>({ id: 0, deptId: 0, categoryId: undefined, name: '', spec: '', unit: '件', location: '', quantity: 0, trackIndividually: false, maxUsageHours: null, note: '' });
    async function load() {
      const res: any = await api.items(query);
      items.value = res.list;
      unitOptions.value = uniqueTextOptions(items.value.map((item) => item.unit), ['件', '台', '部', '只', '个', '箱', '包', '块', '盏', '具', '盒']);
      specOptions.value = uniqueTextOptions(items.value.map((item) => item.spec));
      locationOptions.value = uniqueTextOptions(items.value.map((item) => item.location));
    }
    async function loadQueryCategories() {
      queryCategories.value = await api.categories(query.deptId);
    }
    async function loadCategories(deptId?: number) {
      categories.value = await api.categories(deptId || form.deptId || query.deptId);
    }
    async function changeQueryDept() {
      query.categoryId = undefined;
      await loadQueryCategories();
      await load();
    }
    async function changeFormDept() {
      form.categoryId = undefined;
      await loadCategories(form.deptId);
    }
    function open(row?: Item) {
      const defaults = { id: 0, deptId: query.deptId || props.depts[0]?.id || 0, categoryId: undefined, name: '', spec: '', unit: '件', location: '', quantity: 0, trackIndividually: false, maxUsageHours: null, note: '' };
      Object.assign(form, defaults, row || {});
      if (row && (row.quantity === undefined || row.quantity === null)) {
        form.quantity = 0;
      }
      form.trackIndividually = !!(row && row.trackIndividually);
      form.maxUsageHours = row && row.maxUsageMinutes ? Math.round((row.maxUsageMinutes / 60) * 10) / 10 : null;
      loadCategories(form.deptId);
      dialog.value = true;
    }
    async function save() {
      if (!form.deptId || !form.name) return ElMessage.warning('请选择部门/仓库并填写物品名称');
      const quantity = Number(form.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        return ElMessage.warning('当前库存不能为空，且需要大于等于 0');
      }
      const maxUsageMinutes =
        form.trackIndividually && form.maxUsageHours
          ? Math.round(Number(form.maxUsageHours) * 60)
          : '';
      const payload = {
        deptId: form.deptId,
        categoryId: form.categoryId,
        name: form.name,
        spec: form.spec,
        unit: form.unit,
        location: form.location,
        quantity,
        note: form.note,
        trackIndividually: form.trackIndividually,
        maxUsageMinutes,
      };
      await api.saveItem(payload, form.id || undefined);
      dialog.value = false;
      ElMessage.success('物品已保存');
      await load();
    }
    async function remove(row: Item) {
      await ElMessageBox.confirm(`确定删除物品 ${row.name}？仅没有历史记录的物品可普通删除。`);
      await api.deleteItem(row.id);
      await load();
    }
    async function forceRemove(row: Item) {
      await ElMessageBox.confirm(
        `强制删除物品 ${row.name} 会删除相关历史流水，无法恢复。确认继续？`,
        '危险操作',
        { type: 'warning' },
      );
      await api.deleteItem(row.id, true);
      await load();
    }
    const qrDialog = ref(false);
    const qrItem = ref<Item | null>(null);
    const qrImgUrl = ref('');
    async function showQrCode(row: Item) {
      qrItem.value = row;
      qrDialog.value = true;
      qrImgUrl.value = '';
      const res = await fetch(api.itemQrcodeUrl(row.id, 'png'), {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` },
      });
      if (!res.ok) {
        ElMessage.error('二维码加载失败');
        return;
      }
      const blob = await res.blob();
      qrImgUrl.value = URL.createObjectURL(blob);
    }
    async function downloadQr(format: 'png' | 'pdf') {
      if (!qrItem.value) return;
      const res = await fetch(api.itemQrcodeUrl(qrItem.value.id, format), {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` },
      });
      if (!res.ok) {
        ElMessage.error('下载失败');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `item-${qrItem.value.id}-qrcode.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    function closeQrDialog() {
      if (qrImgUrl.value) URL.revokeObjectURL(qrImgUrl.value);
      qrImgUrl.value = '';
      qrDialog.value = false;
      qrItem.value = null;
    }
    const usageDialog = ref(false);
    const usageLoading = ref(false);
    const usageSummary = ref<any>(null);
    const usageItem = ref<Item | null>(null);
    function formatUsageMinutes(total: number | undefined | null) {
      const minutes = Math.max(0, Math.round(Number(total) || 0));
      if (!minutes) return '0 分钟';
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (!h) return `${m} 分钟`;
      if (!m) return `${h} 小时`;
      return `${h} 小时 ${m} 分钟`;
    }
    function formatUsageDateTime(value: string | undefined | null) {
      if (!value) return '';
      return dayjs(value).format('YYYY-MM-DD HH:mm');
    }
    async function showUsage(row: Item) {
      usageItem.value = row;
      usageDialog.value = true;
      usageSummary.value = null;
      usageLoading.value = true;
      try {
        usageSummary.value = await api.itemUsage(row.id);
      } catch (error: any) {
        ElMessage.error(error?.message || '加载使用情况失败');
      } finally {
        usageLoading.value = false;
      }
    }
    async function forceEndUsage() {
      if (!usageItem.value) return;
      const note = await ElMessageBox.prompt('请输入强制结束原因（可选）', '强制结束使用', {
        confirmButtonText: '确认结束',
        cancelButtonText: '取消',
        inputPlaceholder: '例如：现场员工忘记点结束',
      }).catch(() => null);
      if (note === null) return;
      usageLoading.value = true;
      try {
        usageSummary.value = await api.forceEndUsage(usageItem.value.id, note.value || undefined);
        ElMessage.success('已强制结束');
        await load();
      } catch (error: any) {
        ElMessage.error(error?.message || '操作失败');
      } finally {
        usageLoading.value = false;
      }
    }
    function closeUsageDialog() {
      usageDialog.value = false;
      usageItem.value = null;
      usageSummary.value = null;
    }

    const unitsDialog = ref(false);
    const unitsItem = ref<Item | null>(null);
    const units = ref<any[]>([]);
    const unitsLoading = ref(false);
    function unitStatusText(status: string) {
      if (status === 'in_stock') return '在库可用';
      if (status === 'out') return '已出库（在外）';
      if (status === 'retired') return '已停用/到期';
      return status;
    }
    function unitStatusTag(status: string) {
      if (status === 'in_stock') return 'success';
      if (status === 'out') return 'warning';
      return 'info';
    }
    async function showUnits(row: Item) {
      unitsItem.value = row;
      unitsDialog.value = true;
      await loadUnits();
    }
    async function loadUnits() {
      if (!unitsItem.value) return;
      unitsLoading.value = true;
      try {
        units.value = await api.itemUnits(unitsItem.value.id);
      } catch (error: any) {
        ElMessage.error(error?.message || '加载单台失败');
      } finally {
        unitsLoading.value = false;
      }
    }
    async function renameUnit(u: any) {
      const input = await ElMessageBox.prompt('修改设备编号', '编号', {
        inputValue: u.code,
        confirmButtonText: '保存',
        cancelButtonText: '取消',
      }).catch(() => null);
      if (!input) return;
      await api.updateUnit(u.id, { code: input.value });
      await loadUnits();
      await load();
    }
    async function toggleRetire(u: any) {
      const target = u.status === 'retired' ? 'in_stock' : 'retired';
      await ElMessageBox.confirm(
        target === 'retired'
          ? `停用 ${u.code} 号后，该设备不能再出库。确认？`
          : `恢复 ${u.code} 号为在库可用？`,
      );
      await api.updateUnit(u.id, { status: target });
      await loadUnits();
      await load();
    }
    async function removeUnit(u: any) {
      await ElMessageBox.confirm(`删除 ${u.code} 号？仅在库且无在用时可删除。`, '删除', { type: 'warning' });
      await api.deleteUnit(u.id);
      await loadUnits();
      await load();
    }
    async function forceEndUnit(u: any) {
      if (!unitsItem.value) return;
      await ElMessageBox.confirm(`强制结束 ${u.code} 号的当前使用？`, '强制结束', { type: 'warning' });
      await api.forceEndUsage(unitsItem.value.id, '管理员后台强制结束', u.id);
      await loadUnits();
      await load();
    }
    async function downloadUnitQr(u: any, format: 'png' | 'pdf') {
      const res = await fetch(api.unitQrcodeUrl(u.id, format), {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` },
      });
      if (!res.ok) {
        ElMessage.error('下载失败');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `unit-${u.id}-qrcode.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    const unitQrDialog = ref(false);
    const unitQrUnit = ref<any>(null);
    const unitQrImgUrl = ref('');
    async function showUnitQr(u: any) {
      unitQrUnit.value = u;
      unitQrDialog.value = true;
      unitQrImgUrl.value = '';
      const res = await fetch(api.unitQrcodeUrl(u.id, 'png'), {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` },
      });
      if (!res.ok) {
        ElMessage.error('二维码加载失败');
        return;
      }
      const blob = await res.blob();
      unitQrImgUrl.value = URL.createObjectURL(blob);
    }
    function closeUnitQrDialog() {
      if (unitQrImgUrl.value) URL.revokeObjectURL(unitQrImgUrl.value);
      unitQrImgUrl.value = '';
      unitQrDialog.value = false;
      unitQrUnit.value = null;
    }
    function closeUnitsDialog() {
      unitsDialog.value = false;
      unitsItem.value = null;
      units.value = [];
    }

    onMounted(async () => {
      await loadQueryCategories();
      await load();
    });
    return { props, items, categories, queryCategories, unitOptions, specOptions, locationOptions, query, dialog, form, load, loadCategories, changeQueryDept, changeFormDept, open, save, remove, forceRemove, qrDialog, qrItem, qrImgUrl, showQrCode, downloadQr, closeQrDialog, usageDialog, usageLoading, usageSummary, usageItem, showUsage, forceEndUsage, closeUsageDialog, formatUsageMinutes, formatUsageDateTime, unitsDialog, unitsItem, units, unitsLoading, unitStatusText, unitStatusTag, showUnits, renameUnit, toggleRetire, removeUnit, forceEndUnit, downloadUnitQr, closeUnitsDialog, unitQrDialog, unitQrUnit, unitQrImgUrl, showUnitQr, closeUnitQrDialog };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-select v-model="query.deptId" filterable clearable placeholder="部门/仓库" style="width:180px" @change="changeQueryDept" @clear="changeQueryDept">
          <el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-select v-model="query.categoryId" filterable clearable placeholder="库存类目" style="width:180px" @change="load" @clear="load">
          <el-option v-for="c in queryCategories" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input v-model="query.keyword" clearable placeholder="名称/规格/位置" style="width:220px" @keyup.enter="load" />
        <el-button @click="load">查询</el-button>
        <el-button type="primary" @click="open()">新增物品</el-button>
      </div>
      <el-table :data="items">
        <el-table-column prop="name" label="名称" />
        <el-table-column label="部门"><template #default="{row}">{{ row.dept?.name }}</template></el-table-column>
        <el-table-column label="类目"><template #default="{row}">{{ row.category?.name }}</template></el-table-column>
        <el-table-column prop="spec" label="规格" />
        <el-table-column prop="quantity" label="库存" width="80" />
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column prop="location" label="存放位置" />
        <el-table-column label="管理方式" width="150"><template #default="{row}">
          <template v-if="row.trackIndividually">
            <el-tag type="warning" size="small">按单台</el-tag>
            <div class="muted" style="margin-top:4px" v-if="row.unitStats">在库{{ row.unitStats.inStock }}·在外{{ row.unitStats.out }}·停用{{ row.unitStats.retired }}</div>
          </template>
          <el-tag v-else type="info" size="small">按数量</el-tag>
        </template></el-table-column>
        <el-table-column label="使用状态" min-width="170"><template #default="{row}">
          <template v-if="row.trackIndividually && row.unitStats">
            <el-tag v-if="row.unitStats.inUse" type="success">使用中 {{ row.unitStats.inUse }} 台</el-tag>
            <el-tag v-else type="info">空闲</el-tag>
          </template>
          <template v-else>
            <el-tag v-if="row.usageOngoing" type="success">使用中</el-tag>
            <el-tag v-else type="info">空闲</el-tag>
          </template>
          <div class="muted" style="margin-top:4px">累计 {{ formatUsageMinutes(row.usageTotalMinutes) }}</div>
        </template></el-table-column>
        <el-table-column label="操作" width="380"><template #default="{row}">
          <el-button link type="primary" @click="open(row)">编辑</el-button>
          <el-button v-if="row.trackIndividually" link type="primary" @click="showUnits(row)">单台管理</el-button>
          <el-button v-else link type="primary" @click="showUsage(row)">使用情况</el-button>
          <el-button link type="success" @click="showQrCode(row)">二维码</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
          <el-button v-if="props.isSuper" link type="danger" @click="forceRemove(row)">强制删除</el-button>
        </template></el-table-column>
      </el-table>
      <el-dialog :model-value="unitsDialog" title="单台设备管理" width="760px" @close="closeUnitsDialog">
        <div v-if="unitsItem">
          <p><b>{{ unitsItem.name }}</b> <span class="muted">{{ unitsItem.spec || '' }}</span></p>
          <p class="muted">每台独立计时、独立二维码；到期或停用的设备不可出库。</p>
          <el-table :data="units" v-loading="unitsLoading" size="small">
            <el-table-column label="编号" prop="code" width="90" />
            <el-table-column label="状态" width="130"><template #default="{row}"><el-tag :type="unitStatusTag(row.status)">{{ unitStatusText(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="使用" width="120"><template #default="{row}"><span v-if="row.inUse" style="color:#16a34a">使用中</span><span v-else class="muted">空闲</span></template></el-table-column>
            <el-table-column label="累计时长"><template #default="{row}">{{ formatUsageMinutes(row.accumulatedMinutes) }}<span v-if="row.maxUsageMinutes" class="muted"> / 上限 {{ formatUsageMinutes(row.maxUsageMinutes) }}</span></template></el-table-column>
            <el-table-column label="操作" width="280"><template #default="{row}">
              <el-button link type="primary" @click="renameUnit(row)">改编号</el-button>
              <el-button link type="success" @click="showUnitQr(row)">二维码</el-button>
              <el-button v-if="row.inUse" link type="danger" @click="forceEndUnit(row)">结束使用</el-button>
              <el-button link :type="row.status==='retired' ? 'success':'warning'" @click="toggleRetire(row)">{{ row.status==='retired' ? '恢复':'停用' }}</el-button>
              <el-button link type="danger" @click="removeUnit(row)">删除</el-button>
            </template></el-table-column>
          </el-table>
        </div>
        <template #footer><el-button type="primary" @click="closeUnitsDialog">关闭</el-button></template>
      </el-dialog>
      <el-dialog :model-value="unitQrDialog" title="设备二维码" width="380px" @close="closeUnitQrDialog">
        <div style="text-align:center" v-if="unitQrUnit">
          <p><b>{{ unitsItem && unitsItem.name }} · {{ unitQrUnit.code }} 号</b></p>
          <div style="margin:12px 0">
            <img v-if="unitQrImgUrl" :src="unitQrImgUrl" style="width:260px;height:260px" />
            <span v-else class="muted">生成中…</span>
          </div>
          <p class="muted">小程序「扫码出入库」扫描后进入该设备详情，可单独计时。</p>
        </div>
        <template #footer>
          <el-button @click="downloadUnitQr(unitQrUnit,'png')" :disabled="!unitQrUnit">下载 PNG</el-button>
          <el-button @click="downloadUnitQr(unitQrUnit,'pdf')" :disabled="!unitQrUnit">下载打印 PDF</el-button>
          <el-button type="primary" @click="closeUnitQrDialog">关闭</el-button>
        </template>
      </el-dialog>
      <el-dialog :model-value="usageDialog" title="设备使用情况" width="640px" @close="closeUsageDialog">
        <div v-if="usageItem">
          <p><b>{{ usageItem.name }}</b> <span class="muted">{{ usageItem.spec || '' }}</span></p>
          <div v-if="usageLoading" class="muted">加载中…</div>
          <template v-else-if="usageSummary">
            <div style="margin:12px 0">
              <el-tag v-if="usageSummary.ongoing" type="success" effect="dark">使用中 · {{ formatUsageMinutes(usageSummary.ongoing.durationMinutes) }}</el-tag>
              <el-tag v-else type="info">空闲</el-tag>
              <span class="muted" style="margin-left:12px">累计：{{ formatUsageMinutes(usageSummary.totalMinutes) }}</span>
            </div>
            <div v-if="usageSummary.ongoing" class="page-card" style="background:#f0fdf4">
              <div>当前使用人：{{ usageSummary.ongoing.operatorName }}</div>
              <div>开始时间：{{ formatUsageDateTime(usageSummary.ongoing.startedAt) }}</div>
              <div>本次已用：{{ formatUsageMinutes(usageSummary.ongoing.durationMinutes) }}</div>
              <div style="margin-top:12px">
                <el-button type="danger" :loading="usageLoading" @click="forceEndUsage">强制结束</el-button>
              </div>
            </div>
            <p class="muted" style="margin-top:18px">最近使用记录</p>
            <el-table :data="usageSummary.recent || []" size="small">
              <el-table-column label="操作人" prop="operatorName" width="120" />
              <el-table-column label="开始"><template #default="{row}">{{ formatUsageDateTime(row.startedAt) }}</template></el-table-column>
              <el-table-column label="结束"><template #default="{row}">{{ row.endedAt ? formatUsageDateTime(row.endedAt) : '使用中' }}</template></el-table-column>
              <el-table-column label="时长" width="120"><template #default="{row}">{{ row.endedAt ? formatUsageMinutes(row.durationMinutes) : '-' }}</template></el-table-column>
              <el-table-column label="备注"><template #default="{row}">{{ row.note || '-' }}</template></el-table-column>
            </el-table>
          </template>
        </div>
        <template #footer>
          <el-button type="primary" @click="closeUsageDialog">关闭</el-button>
        </template>
      </el-dialog>
      <el-dialog :model-value="qrDialog" title="设备二维码" width="380px" @close="closeQrDialog">
        <div style="text-align:center" v-if="qrItem">
          <p><b>{{ qrItem.name }}</b></p>
          <p class="muted">{{ qrItem.spec || '无规格' }}</p>
          <div style="margin:12px 0">
            <img v-if="qrImgUrl" :src="qrImgUrl" style="width:260px;height:260px" />
            <span v-else class="muted">生成中…</span>
          </div>
          <p class="muted">小程序「扫码出入库」扫描后，可直接进入该设备详情。</p>
        </div>
        <template #footer>
          <el-button @click="downloadQr('png')" :disabled="!qrItem">下载 PNG</el-button>
          <el-button @click="downloadQr('pdf')" :disabled="!qrItem">下载打印 PDF</el-button>
          <el-button type="primary" @click="closeQrDialog">关闭</el-button>
        </template>
      </el-dialog>
      <el-dialog v-model="dialog" title="物品">
        <el-form label-width="90px">
          <el-form-item label="部门"><el-select v-model="form.deptId" filterable clearable placeholder="选择部门/仓库" @change="changeFormDept" @clear="changeFormDept"><el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" /></el-select></el-form-item>
          <el-form-item label="类目"><el-select v-model="form.categoryId" filterable clearable placeholder="选择库存类目"><el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" /></el-select></el-form-item>
          <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="规格"><el-select v-model="form.spec" filterable allow-create default-first-option clearable placeholder="选择或输入规格"><el-option v-for="s in specOptions" :key="s" :label="s" :value="s" /></el-select></el-form-item>
          <el-form-item label="单位"><el-select v-model="form.unit" filterable allow-create default-first-option clearable placeholder="选择或输入单位"><el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" /></el-select></el-form-item>
          <el-form-item label="存放位置"><el-select v-model="form.location" filterable allow-create default-first-option clearable placeholder="选择或输入存放位置"><el-option v-for="l in locationOptions" :key="l" :label="l" :value="l" /></el-select></el-form-item>
          <el-form-item label="当前库存"><el-input-number v-model="form.quantity" :min="0" :step="1" controls-position="right" /><span class="muted" style="margin-left:8px">新建时为初始库存；编辑时直接覆盖。按单台管理时表示单台数量。</span></el-form-item>
          <el-form-item label="按单台管理">
            <el-switch v-model="form.trackIndividually" />
            <span class="muted" style="margin-left:8px">打开后会按数量生成 1~N 号单台，每台独立计时、独立二维码、可单独停用；耗材类请关闭。</span>
          </el-form-item>
          <el-form-item v-if="form.trackIndividually" label="使用时长上限">
            <el-input-number v-model="form.maxUsageHours" :min="0" :step="1" controls-position="right" />
            <span class="muted" style="margin-left:8px">小时；单台累计使用达到上限后自动标记“到期/停用”，不能再出库。留空表示不限。</span>
          </el-form-item>
          <el-form-item label="备注"><el-input v-model="form.note" type="textarea" /></el-form-item>
        </el-form>
        <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
      </el-dialog>
    </div>`,
});

const RecordPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true } },
  setup(props) {
    const records = ref<StockRecord[]>([]);
    const query = reactive<any>({ page: 1, pageSize: 50, deptId: undefined, keyword: '', type: undefined, startDate: '', endDate: '' });
    const detail = ref<StockRecord | null>(null);
    const selected = ref<StockRecord[]>([]);
    const tableRef = ref<any>(null);
    async function load() {
      const res: any = await api.records(query);
      records.value = res.list;
      selected.value = [];
      tableRef.value?.clearSelection?.();
    }
    function onSelectionChange(rows: StockRecord[]) {
      selected.value = rows;
    }
    async function downloadBlob(url: string, filename: string, init?: RequestInit) {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}`,
          ...(init && init.headers ? init.headers : {}),
        },
      });
      if (!res.ok) {
        ElMessage.error('导出失败，请重新登录后再试');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    async function downloadExport(format: string) {
      const params = new URLSearchParams();
      Object.keys(query).forEach((key) => query[key] && params.set(key, query[key]));
      params.set('format', format);
      await downloadBlob(`/api/export/stock-record?${params.toString()}`, `stock-record-${Date.now()}.${format}`);
    }
    async function downloadSingle(row: StockRecord, format: string) {
      await downloadBlob(`/api/export/stock-record/${row.id}?format=${format}`, `stock-record-${row.id}.${format}`);
    }
    async function downloadBatch(format: string) {
      if (!selected.value.length) return ElMessage.warning('请先勾选要导出的记录');
      const ids = selected.value.map((row) => row.id);
      await downloadBlob('/api/export/stock-record/batch', `stock-record-batch-${Date.now()}.${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, format }),
      });
    }
    async function removeSingle(row: StockRecord) {
      await ElMessageBox.confirm(
        `删除 ${dayjs(row.occurredAt).format('YYYY-MM-DD HH:mm')} 的「${row.projectName || '出入库'}」记录？仅删除流水，不会改动库存数量，不可恢复。`,
        '删除确认',
        { type: 'warning' },
      );
      await api.deleteRecord(row.id);
      ElMessage.success('已删除');
      await load();
    }
    async function removeBatch() {
      if (!selected.value.length) return ElMessage.warning('请先勾选要删除的记录');
      const ids = selected.value.map((row) => row.id);
      await ElMessageBox.confirm(
        `共选择 ${ids.length} 条记录，确认全部删除？仅删除流水，不会改动库存数量，不可恢复。`,
        '批量删除',
        { type: 'warning' },
      );
      const res: any = await api.bulkDeleteRecords(ids);
      ElMessage.success(`已删除 ${res?.deleted ?? ids.length} 条`);
      await load();
    }
    function openMap(row: StockRecord) {
      if (!row.latitude || !row.longitude) return ElMessage.warning('没有定位信息');
      window.open(`https://apis.map.qq.com/uri/v1/marker?marker=coord:${row.latitude},${row.longitude};title:${encodeURIComponent(row.poiName || row.address || '出入库位置')}`, '_blank');
    }
    onMounted(load);
    return {
      props,
      records,
      query,
      detail,
      selected,
      tableRef,
      load,
      onSelectionChange,
      downloadExport,
      downloadSingle,
      downloadBatch,
      removeSingle,
      removeBatch,
      openMap,
      dayjs,
    };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-select v-model="query.deptId" filterable clearable placeholder="部门/仓库" style="width:180px" @change="load" @clear="load"><el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" /></el-select>
        <el-select v-model="query.type" filterable clearable placeholder="类型" style="width:120px" @change="load" @clear="load"><el-option label="入库" value="in" /><el-option label="出库" value="out" /></el-select>
        <el-input v-model="query.keyword" clearable placeholder="项目/物品/操作人/地址" style="width:240px" @keyup.enter="load" />
        <el-date-picker v-model="query.startDate" clearable type="date" value-format="YYYY-MM-DD" placeholder="开始日期" />
        <el-date-picker v-model="query.endDate" clearable type="date" value-format="YYYY-MM-DD" placeholder="结束日期" />
        <el-button @click="load">查询</el-button>
        <el-button @click="downloadExport('xlsx')">按筛选导出 Excel</el-button>
        <el-button @click="downloadExport('docx')">按筛选导出 Word</el-button>
        <el-button @click="downloadExport('pdf')">按筛选导出 PDF</el-button>
      </div>
      <div class="toolbar">
        <span class="muted">已选 {{ selected.length }} 条</span>
        <el-button :disabled="!selected.length" @click="downloadBatch('xlsx')">批量导出 Excel</el-button>
        <el-button :disabled="!selected.length" @click="downloadBatch('docx')">批量导出 Word</el-button>
        <el-button :disabled="!selected.length" @click="downloadBatch('pdf')">批量导出 PDF</el-button>
        <el-button :disabled="!selected.length" type="danger" @click="removeBatch">批量删除</el-button>
      </div>
      <el-table ref="tableRef" :data="records" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46" />
        <el-table-column type="expand">
          <template #default="{row}">
            <div style="padding:8px 24px">
              <p><b>项目名称：</b>{{ row.projectName || '-' }}</p>
              <p v-if="row.unitSummary"><b>设备编号：</b>{{ row.unitSummary }}</p>
              <el-table :data="row.items || []" size="small" style="margin:8px 0">
                <el-table-column label="物品"><template #default="s">{{ s.row.item?.name }}</template></el-table-column>
                <el-table-column label="规格"><template #default="s">{{ s.row.item?.spec }}</template></el-table-column>
                <el-table-column label="数量"><template #default="s">{{ s.row.quantity }} {{ s.row.item?.unit }}</template></el-table-column>
              </el-table>
              <p class="muted">操作人：{{ row.operatorName }} ｜ 位置：{{ row.poiName || row.address || '无' }}</p>
              <p class="muted" v-if="row.note">备注：{{ row.note }}</p>
              <div class="image-list">
                <el-image v-for="p in row.photos || []" :key="p" :src="p" style="width:90px;height:90px" fit="cover" :preview-src-list="row.photos" />
                <el-image v-if="row.signatureUrl" :src="row.signatureUrl" style="width:160px;height:90px;background:#f8fafc" fit="contain" />
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="日期" width="150"><template #default="{row}">{{ dayjs(row.occurredAt).format('YYYY-MM-DD HH:mm') }}</template></el-table-column>
        <el-table-column label="部门"><template #default="{row}">{{ row.dept?.name }}</template></el-table-column>
        <el-table-column prop="projectName" label="项目名称" />
        <el-table-column label="物品明细" min-width="220"><template #default="{row}">{{ row.itemSummary }}<span v-if="row.unitSummary" class="muted">（{{ row.unitSummary }}）</span></template></el-table-column>
        <el-table-column label="类型"><template #default="{row}"><el-tag :type="row.type==='in'?'success':'warning'">{{ row.type==='in'?'入库':'出库' }}</el-tag></template></el-table-column>
        <el-table-column label="状态" width="130"><template #default="{row}">
          <el-tag v-if="row.type==='out' && row.completed" type="success">已完成</el-tag>
          <el-tag v-else-if="row.type==='out'" type="warning">待归还</el-tag>
          <el-tag v-else type="info">入库</el-tag>
        </template></el-table-column>
        <el-table-column prop="quantity" label="合计数量" width="90" />
        <el-table-column prop="operatorName" label="操作人" />
        <el-table-column label="位置"><template #default="{row}">{{ row.poiName || row.address }}</template></el-table-column>
        <el-table-column label="操作" width="360"><template #default="{row}">
          <el-button link type="primary" @click="detail=row">查看详情</el-button>
          <el-button link type="success" @click="openMap(row)">查看位置</el-button>
          <el-dropdown trigger="click" @command="(format) => downloadSingle(row, format)" style="margin-left:8px">
            <el-button link type="primary">导出本单 ▾</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="xlsx">Excel</el-dropdown-item>
                <el-dropdown-item command="docx">Word</el-dropdown-item>
                <el-dropdown-item command="pdf">PDF</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button link type="danger" @click="removeSingle(row)">删除本单</el-button>
        </template></el-table-column>
      </el-table>
      <el-dialog :model-value="!!detail" title="出入库详情" @close="detail=null">
        <template v-if="detail">
          <p><b>项目名称：</b>{{ detail.projectName }}</p>
          <el-table :data="detail.items || []" size="small" style="margin-bottom:16px">
            <el-table-column label="物品"><template #default="{row}">{{ row.item?.name }}</template></el-table-column>
            <el-table-column label="规格"><template #default="{row}">{{ row.item?.spec }}</template></el-table-column>
            <el-table-column label="数量"><template #default="{row}">{{ row.quantity }} {{ row.item?.unit }}</template></el-table-column>
          </el-table>
          <p>{{ detail.poiName }} {{ detail.address }} {{ detail.longitude }},{{ detail.latitude }}</p>
          <div class="image-list">
            <el-image v-for="p in detail.photos || []" :key="p" :src="p" style="width:120px;height:120px" fit="cover" :preview-src-list="detail.photos" />
            <el-image v-if="detail.signatureUrl" :src="detail.signatureUrl" style="width:220px;height:120px;background:#f8fafc" fit="contain" />
          </div>
        </template>
        <template #footer v-if="detail">
          <el-button @click="downloadSingle(detail, 'xlsx')">导出 Excel</el-button>
          <el-button @click="downloadSingle(detail, 'docx')">导出 Word</el-button>
          <el-button @click="downloadSingle(detail, 'pdf')">导出 PDF</el-button>
          <el-button type="primary" @click="detail=null">关闭</el-button>
        </template>
      </el-dialog>
    </div>`,
});

const PasswordPage = defineComponent({
  props: { force: { type: Boolean, default: false } },
  emits: ['changed'],
  setup(props, { emit }) {
    const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });
    async function save() {
      if (!form.oldPassword || !form.newPassword) {
        return ElMessage.warning('请填写原密码和新密码');
      }
      if (form.newPassword.length < 6) {
        return ElMessage.warning('新密码至少 6 位');
      }
      if (form.newPassword !== form.confirmPassword) {
        return ElMessage.warning('两次输入的新密码不一致');
      }
      if (form.newPassword === form.oldPassword) {
        return ElMessage.warning('新密码不能与原密码相同');
      }
      await api.changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
      ElMessage.success('密码已修改');
      Object.assign(form, { oldPassword: '', newPassword: '', confirmPassword: '' });
      emit('changed');
    }
    return { props, form, save };
  },
  template: `
    <div class="page-card password">
      <p v-if="props.force" class="muted">首次登录请修改初始密码，新密码至少 6 位，与原密码不同。</p>
      <el-form label-width="100px">
        <el-form-item label="原密码"><el-input v-model="form.oldPassword" type="password" show-password autocomplete="off" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="form.newPassword" type="password" show-password autocomplete="off" /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="form.confirmPassword" type="password" show-password autocomplete="off" /></el-form-item>
        <el-button type="primary" @click="save">保存</el-button>
      </el-form>
    </div>`,
});
</script>

<style scoped>
.login-wrap {
  display: grid;
  min-height: 100vh;
  place-items: center;
  background: linear-gradient(135deg, #eef6ff, #f8fafc);
}

.login-card {
  width: 360px;
}

.full {
  width: 100%;
}

.shell {
  min-height: 100vh;
}

.aside {
  color: #fff;
  background: #111827;
}

.aside h2 {
  padding-left: 22px;
}

.aside :deep(.el-menu) {
  border: 0;
  background: transparent;
}

.aside :deep(.el-menu-item) {
  color: #cbd5e1;
}

.aside :deep(.is-active) {
  color: #fff;
  background: #2563eb;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 18px;
}

.stat {
  padding: 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 6px 22px rgb(15 23 42 / 6%);
}

.stat b {
  display: block;
  margin-bottom: 8px;
  font-size: 32px;
}

.password {
  max-width: 520px;
}
</style>
