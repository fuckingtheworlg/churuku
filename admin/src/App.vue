<template>
  <div v-if="!token" class="login-wrap">
    <el-card class="login-card">
      <h2>Churuku 管理后台</h2>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="账号">
          <el-input v-model="loginForm.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="loginForm.password" type="password" show-password />
        </el-form-item>
        <el-button type="primary" class="full" :loading="loading" @click="login">登录</el-button>
        <p class="muted">默认账号：admin / admin123</p>
      </el-form>
    </el-card>
  </div>
  <el-container v-else class="shell">
    <el-aside width="220px" class="aside">
      <h2>Churuku</h2>
      <el-menu :default-active="active" @select="active = $event">
        <el-menu-item index="dashboard">仪表盘</el-menu-item>
        <el-menu-item index="dept">部门</el-menu-item>
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
        <el-button link type="danger" @click="logout">退出</el-button>
      </el-header>
      <el-main>
        <Dashboard v-if="active === 'dashboard'" />
        <DeptPage v-else-if="active === 'dept'" @changed="refreshOptions" />
        <UserPage v-else-if="active === 'user'" :depts="depts" />
        <CategoryPage v-else-if="active === 'category'" :depts="depts" />
        <ItemPage v-else-if="active === 'item'" :depts="depts" />
        <RecordPage v-else-if="active === 'record'" :depts="depts" />
        <PasswordPage v-else />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { defineComponent, h, onMounted, reactive, ref, watch } from 'vue';
import { api, Dept, Item, StockRecord, User } from './api';

const token = ref(localStorage.getItem('admin_token') || '');
const loading = ref(false);
const active = ref('dashboard');
const depts = ref<Dept[]>([]);
const loginForm = reactive({ username: 'admin', password: 'admin123' });
const titleMap: Record<string, string> = {
  dashboard: '仪表盘',
  dept: '部门管理',
  user: '用户审批',
  category: '库存类目',
  item: '物品库存',
  record: '出入库记录',
  password: '修改密码',
};

async function login() {
  loading.value = true;
  try {
    const res: any = await api.adminLogin(loginForm);
    localStorage.setItem('admin_token', res.token);
    token.value = res.token;
    await refreshOptions();
  } catch (error: any) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

function logout() {
  localStorage.removeItem('admin_token');
  token.value = '';
}

async function refreshOptions() {
  if (!token.value) return;
  depts.value = await api.depts();
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
  emits: ['changed'],
  setup(_, { emit }) {
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
      await ElMessageBox.confirm(`确定删除部门 ${row.name}？`);
      await api.deleteDept(row.id);
      await load();
    }
    onMounted(load);
    return { list, form, save, remove };
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
      await api.updateUserStatus(row.id, status);
      ElMessage.success('已更新');
      await load();
    }
    onMounted(load);
    return { props, users, query, load, setStatus, dayjs };
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
          </template>
        </el-table-column>
      </el-table>
    </div>`,
});

const CategoryPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true } },
  setup(props) {
    const list = ref<any[]>([]);
    const form = reactive({ id: 0, deptId: 0, name: '', sort: 0 });
    function ensureDeptSelected() {
      if (!form.deptId && props.depts.length > 0) {
        form.deptId = props.depts[0].id;
      }
    }
    async function load() {
      ensureDeptSelected();
      list.value = await api.categories(form.deptId || undefined);
    }
    async function save() {
      if (!props.depts.length) return ElMessage.warning('请先在部门管理中新增部门');
      if (!form.deptId || !form.name) return ElMessage.warning('请选择所属部门/仓库并填写类目名称');
      await api.saveCategory({ deptId: form.deptId, name: form.name, sort: form.sort }, form.id || undefined);
      Object.assign(form, { id: 0, name: '', sort: 0 });
      ElMessage.success('类目已保存');
      await load();
    }
    async function remove(row: any) {
      await api.deleteCategory(row.id);
      await load();
    }
    watch(
      () => props.depts,
      () => load(),
      { deep: true },
    );
    onMounted(load);
    return { props, list, form, load, save, remove };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <span class="muted">所属部门/仓库</span>
        <el-select v-model="form.deptId" filterable clearable placeholder="请选择该类目所属部门/仓库" style="width:260px" @change="load" @clear="load">
          <el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" />
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
        <el-table-column prop="sort" label="排序" />
        <el-table-column label="操作"><template #default="{row}">
          <el-button link type="primary" @click="Object.assign(form,row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template></el-table-column>
      </el-table>
    </div>`,
});

const ItemPage = defineComponent({
  props: { depts: { type: Array as () => Dept[], required: true } },
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
    const form = reactive<any>({ id: 0, deptId: 0, categoryId: undefined, name: '', spec: '', unit: '件', location: '', note: '' });
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
      Object.assign(form, row || { id: 0, deptId: query.deptId || props.depts[0]?.id || 0, categoryId: undefined, name: '', spec: '', unit: '件', location: '', note: '' });
      loadCategories(form.deptId);
      dialog.value = true;
    }
    async function save() {
      if (!form.deptId || !form.name) return ElMessage.warning('请选择部门/仓库并填写物品名称');
      await api.saveItem(form, form.id || undefined);
      dialog.value = false;
      ElMessage.success('物品已保存');
      await load();
    }
    async function remove(row: Item) {
      await api.deleteItem(row.id);
      await load();
    }
    onMounted(async () => {
      await loadQueryCategories();
      await load();
    });
    return { props, items, categories, queryCategories, unitOptions, specOptions, locationOptions, query, dialog, form, load, loadCategories, changeQueryDept, changeFormDept, open, save, remove };
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
        <el-table-column prop="quantity" label="库存" />
        <el-table-column prop="unit" label="单位" />
        <el-table-column prop="location" label="存放位置" />
        <el-table-column label="操作" width="160"><template #default="{row}">
          <el-button link type="primary" @click="open(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template></el-table-column>
      </el-table>
      <el-dialog v-model="dialog" title="物品">
        <el-form label-width="90px">
          <el-form-item label="部门"><el-select v-model="form.deptId" filterable clearable placeholder="选择部门/仓库" @change="changeFormDept" @clear="changeFormDept"><el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" /></el-select></el-form-item>
          <el-form-item label="类目"><el-select v-model="form.categoryId" filterable clearable placeholder="选择库存类目"><el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" /></el-select></el-form-item>
          <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="规格"><el-select v-model="form.spec" filterable allow-create default-first-option clearable placeholder="选择或输入规格"><el-option v-for="s in specOptions" :key="s" :label="s" :value="s" /></el-select></el-form-item>
          <el-form-item label="单位"><el-select v-model="form.unit" filterable allow-create default-first-option clearable placeholder="选择或输入单位"><el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" /></el-select></el-form-item>
          <el-form-item label="存放位置"><el-select v-model="form.location" filterable allow-create default-first-option clearable placeholder="选择或输入存放位置"><el-option v-for="l in locationOptions" :key="l" :label="l" :value="l" /></el-select></el-form-item>
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
    async function load() {
      const res: any = await api.records(query);
      records.value = res.list;
    }
    async function downloadExport(format: string) {
      const params = new URLSearchParams();
      Object.keys(query).forEach((key) => query[key] && params.set(key, query[key]));
      params.set('format', format);
      const res = await fetch(`/api/export/stock-record?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` },
      });
      if (!res.ok) {
        ElMessage.error('导出失败，请重新登录后再试');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `stock-record-${Date.now()}.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    function openMap(row: StockRecord) {
      if (!row.latitude || !row.longitude) return ElMessage.warning('没有定位信息');
      window.open(`https://apis.map.qq.com/uri/v1/marker?marker=coord:${row.latitude},${row.longitude};title:${encodeURIComponent(row.poiName || row.address || '出入库位置')}`, '_blank');
    }
    onMounted(load);
    return { props, records, query, detail, load, downloadExport, openMap, dayjs };
  },
  template: `
    <div class="page-card">
      <div class="toolbar">
        <el-select v-model="query.deptId" filterable clearable placeholder="部门/仓库" style="width:180px" @change="load" @clear="load"><el-option v-for="d in props.depts" :key="d.id" :label="d.name" :value="d.id" /></el-select>
        <el-select v-model="query.type" filterable clearable placeholder="类型" style="width:120px" @change="load" @clear="load"><el-option label="入库" value="in" /><el-option label="出库" value="out" /></el-select>
        <el-input v-model="query.keyword" clearable placeholder="物品/操作人/地址" style="width:220px" @keyup.enter="load" />
        <el-date-picker v-model="query.startDate" clearable type="date" value-format="YYYY-MM-DD" placeholder="开始日期" />
        <el-date-picker v-model="query.endDate" clearable type="date" value-format="YYYY-MM-DD" placeholder="结束日期" />
        <el-button @click="load">查询</el-button>
        <el-button @click="downloadExport('xlsx')">导出 Excel</el-button>
        <el-button @click="downloadExport('docx')">导出 Word</el-button>
        <el-button @click="downloadExport('pdf')">导出 PDF</el-button>
      </div>
      <el-table :data="records">
        <el-table-column label="日期" width="150"><template #default="{row}">{{ dayjs(row.occurredAt).format('YYYY-MM-DD HH:mm') }}</template></el-table-column>
        <el-table-column label="部门"><template #default="{row}">{{ row.dept?.name }}</template></el-table-column>
        <el-table-column label="物品"><template #default="{row}">{{ row.item?.name }}</template></el-table-column>
        <el-table-column label="类型"><template #default="{row}"><el-tag :type="row.type==='in'?'success':'warning'">{{ row.type==='in'?'入库':'出库' }}</el-tag></template></el-table-column>
        <el-table-column prop="quantity" label="数量" />
        <el-table-column prop="operatorName" label="操作人" />
        <el-table-column label="位置"><template #default="{row}">{{ row.poiName || row.address }}</template></el-table-column>
        <el-table-column label="操作" width="220"><template #default="{row}">
          <el-button link type="primary" @click="detail=row">查看图片/签字</el-button>
          <el-button link type="success" @click="openMap(row)">查看位置</el-button>
        </template></el-table-column>
      </el-table>
      <el-dialog :model-value="!!detail" title="附件" @close="detail=null">
        <template v-if="detail">
          <p>{{ detail.poiName }} {{ detail.address }} {{ detail.longitude }},{{ detail.latitude }}</p>
          <div class="image-list">
            <el-image v-for="p in detail.photos || []" :key="p" :src="p" style="width:120px;height:120px" fit="cover" :preview-src-list="detail.photos" />
            <el-image v-if="detail.signatureUrl" :src="detail.signatureUrl" style="width:220px;height:120px;background:#f8fafc" fit="contain" />
          </div>
        </template>
      </el-dialog>
    </div>`,
});

const PasswordPage = defineComponent({
  setup() {
    const form = reactive({ oldPassword: '', newPassword: '' });
    async function save() {
      await api.changePassword(form);
      ElMessage.success('密码已修改');
      Object.assign(form, { oldPassword: '', newPassword: '' });
    }
    return { form, save };
  },
  template: `
    <div class="page-card password">
      <el-form label-width="90px">
        <el-form-item label="原密码"><el-input v-model="form.oldPassword" type="password" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="form.newPassword" type="password" /></el-form-item>
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
