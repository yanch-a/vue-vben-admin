<script>
  /**
   * 数据库连接配置：方片化管理；公开性、密码留空不改、会员授权分配
   * @author yanch
   */
  import { defineComponent, inject, onMounted, reactive, ref } from 'vue'
  import { useRouter } from 'vue-router'

  import { getMemberUser, searchMemberUser } from '@/api/member/memberUser'
  import { testConnection } from '@/api/visual/database'
  import {
    deleteDbConfig,
    editDbConfig,
    getDbConfigPage,
    getVqDict,
    listDbConfigUsers,
    listMemberUserGroups,
    listMemberUsersByGroup,
    replaceDbConfigUsers,
  } from '@/api/visual/vq'
  import { Plus, Search } from '@element-plus/icons-vue'
  import { ElMessage, ElMessageBox } from 'element-plus'

  import { resolveDbType } from '../client/dialect/dbTypes'

  export default defineComponent({
    name: 'DbConfig',
    setup() {
      const router = useRouter()
      const loading = ref(false)
      const dialogVisible = ref(false)
      const dialogType = ref('add')
      const formRef = ref(null)
      const totalNum = ref(0)
      const tableData = ref([])
      const dataBaseType = ref([])
      const $baseMessage = inject('$baseMessage')

      const form = reactive({
        id: undefined,
        dbName: '',
        schemaName: '',
        dbType: '',
        dbHost: '',
        dbPort: 3306,
        jdbcUrl: '',
        username: '',
        password: '',
        description: '',
        orderNum: 0,
        isPublic: 0,
        sshEnabled: 0,
        sshHost: '',
        sshPort: 22,
        sshUsername: '',
        sshPassword: '',
        sshPrivateKey: '',
        sshPassphrase: '',
      })

      const sshAuthMode = ref('password')

      const queryForm = reactive({
        pageNum: 1,
        pageSize: 12,
        dbName: '',
      })

      const rules = {
        dbName: [
          { required: true, message: '请输入数据库名称', trigger: 'blur' },
        ],
        schemaName: [
          { required: true, message: '请输入默认数据库', trigger: 'blur' },
        ],
        dbType: [
          { required: true, message: '请选择数据库类型', trigger: 'change' },
        ],
        dbHost: [
          { required: true, message: '请输入主机地址', trigger: 'blur' },
        ],
        dbPort: [{ required: true, message: '请输入端口', trigger: 'blur' }],
        username: [
          { required: true, message: '请输入用户名', trigger: 'blur' },
        ],
        // 新增必填；编辑留空表示不改密码
        password: [
          {
            validator: (_r, v, cb) => {
              if (dialogType.value === 'add' && !v) {
                cb(new Error('请输入密码'))
              } else {
                cb()
              }
            },
            trigger: 'blur',
          },
        ],
      }

      // ---------- 授权弹窗 ----------
      const authVisible = ref(false)
      const authSaving = ref(false)
      const authDbConfigId = ref(null)
      const authDbName = ref('')
      const memberGroups = ref([])
      const selectedGroupId = ref(null)
      const groupUsers = ref([])
      /** { memberUserId, userName, realName, canUse, canWriteData, canWriteSchema, canEditCanvas } */
      const grants = ref([])
      const searchKeyword = ref('')

      const getList = async () => {
        loading.value = true
        try {
          const { list, total } = await getDbConfigPage(queryForm)
          tableData.value = list
          totalNum.value = total
        } catch (error) {
          $baseMessage(
            '获取数据库配置列表失败',
            'error',
            'vab-hey-message-error',
          )
        } finally {
          loading.value = false
        }
      }

      const handleAdd = () => {
        dialogType.value = 'add'
        Object.assign(form, {
          id: undefined,
          dbName: '',
          schemaName: '',
          dbType: '',
          dbHost: '',
          dbPort: 3306,
          jdbcUrl: '',
          username: '',
          password: '',
          description: '',
          orderNum: 0,
          isPublic: 0,
          sshEnabled: 0,
          sshHost: '',
          sshPort: 22,
          sshUsername: '',
          sshPassword: '',
          sshPrivateKey: '',
          sshPassphrase: '',
        })
        sshAuthMode.value = 'password'
        dialogVisible.value = true
      }

      const handleEdit = (row) => {
        dialogType.value = 'edit'
        Object.assign(form, {
          ...row,
          // 密码不回显；留空提交则后端保留原密码
          password: '',
          sshPassword: '',
          sshPrivateKey: '',
          sshPassphrase: '',
          isPublic: row.isPublic == null ? 0 : row.isPublic,
        })
        sshAuthMode.value = row.sshPrivateKey ? 'key' : 'password'
        dialogVisible.value = true
      }

      const testConnectionMethod = async (row) => {
        const { data } = await testConnection(row.id)
        if (data.success) {
          ElMessage.success('连接成功')
        } else {
          ElMessage.error('连接失败')
        }
        // 测试后刷新列表，同步连接状态等展示字段
        await getList()
      }

      const handleDelete = (row) => {
        ElMessageBox.confirm('确认删除该数据库配置吗？', '提示', {
          type: 'warning',
        }).then(async () => {
          try {
            await deleteDbConfig({ ids: row.id })
            ElMessage.success('删除成功')
            getList()
          } catch (error) {
            console.error('删除数据库配置失败:', error)
            ElMessage.error('删除数据库配置失败')
          }
        })
      }

      const handleCanvas = (row) => {
        router.push({ name: 'DbConfigCanvas', query: { id: row.id } })
      }

      const handleRelationCanvas = (row) => {
        router.push({
          name: 'RelationCanvas',
          query: {
            id: row.id,
            ...(row.schemaName ? { instance: row.schemaName } : {}),
          },
        })
      }

      const handleSubmit = async () => {
        if (!formRef.value) return
        await formRef.value.validate(async (valid) => {
          if (valid) {
            try {
              dialogVisible.value = false
              const payload = { ...form }
              // 编辑且密码为空：不传 password，避免误清空
              if (dialogType.value === 'edit' && !payload.password) {
                delete payload.password
              }
              if (dialogType.value === 'edit' && !payload.sshPassword) {
                delete payload.sshPassword
              }
              if (dialogType.value === 'edit' && !payload.sshPrivateKey) {
                delete payload.sshPrivateKey
              }
              if (dialogType.value === 'edit' && !payload.sshPassphrase) {
                delete payload.sshPassphrase
              }
              if (sshAuthMode.value === 'password') {
                payload.sshPrivateKey = dialogType.value === 'edit' ? '' : ''
              } else if (dialogType.value === 'edit') {
                payload.sshPassword = ''
              } else {
                payload.sshPassword = ''
              }
              const { msg } = await editDbConfig(payload)
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              getList()
            } catch (error) {
              console.error('保存数据库配置失败:', error)
              ElMessage.error('保存数据库配置失败')
            }
          }
        })
      }

      const openAuthDialog = async (row) => {
        authDbConfigId.value = row.id
        authDbName.value = row.dbName || ''
        authVisible.value = true
        selectedGroupId.value = null
        groupUsers.value = []
        searchKeyword.value = ''
        try {
          const [{ data: groups }, { data: existing }] = await Promise.all([
            listMemberUserGroups(),
            listDbConfigUsers(row.id),
          ])
          memberGroups.value = groups || []
          grants.value = (existing || []).map((g) => ({
            memberUserId: g.memberUserId,
            userName: g.userName || '',
            realName: g.realName || '',
            canUse: g.canUse == null ? 1 : g.canUse,
            canEditCanvas: g.canEditCanvas == null ? 0 : g.canEditCanvas,
            canWriteData: g.canWriteData == null ? 0 : g.canWriteData,
            canWriteSchema: g.canWriteSchema == null ? 0 : g.canWriteSchema,
          }))
          await enrichGrantNames(grants.value)
        } catch (e) {
          console.error(e)
          ElMessage.error('加载授权信息失败')
        }
      }

      /** 授权表只有会员ID时，补全用户名/姓名便于识别 */
      const enrichGrantNames = async (list) => {
        const need = (list || []).filter((g) => g.memberUserId && !g.userName)
        if (!need.length) return
        await Promise.all(
          need.map(async (g) => {
            try {
              const { data } = await getMemberUser(g.memberUserId)
              if (data) {
                g.userName = data.userName || String(g.memberUserId)
                g.realName = data.realName || ''
              }
            } catch {
              g.userName = g.userName || String(g.memberUserId)
            }
          }),
        )
      }

      const onSelectGroup = async (groupId) => {
        selectedGroupId.value = groupId
        if (!groupId) {
          groupUsers.value = []
          return
        }
        try {
          const { data } = await listMemberUsersByGroup(groupId)
          groupUsers.value = data || []
        } catch (e) {
          console.error(e)
          groupUsers.value = []
        }
      }

      const upsertGrant = (user, defaults = {}) => {
        const id = user.id || user.memberUserId
        if (!id) return
        const idx = grants.value.findIndex((g) => String(g.memberUserId) === String(id))
        const row = {
          memberUserId: id,
          userName: user.userName || user.username || String(id),
          realName: user.realName || '',
          canUse: defaults.canUse != null ? defaults.canUse : 1,
          canEditCanvas: defaults.canEditCanvas != null ? defaults.canEditCanvas : 0,
          canWriteData: defaults.canWriteData != null ? defaults.canWriteData : 0,
          canWriteSchema: defaults.canWriteSchema != null ? defaults.canWriteSchema : 0,
        }
        if (idx >= 0) {
          grants.value[idx] = { ...grants.value[idx], ...row }
        } else {
          grants.value.push(row)
        }
      }

      const addGroupAllUsers = () => {
        if (!groupUsers.value.length) {
          ElMessage.warning('该分组下没有会员，请先在会员管理中分配分组')
          return
        }
        for (const u of groupUsers.value) {
          upsertGrant(u)
        }
        ElMessage.success(`已勾选本组 ${groupUsers.value.length} 名用户`)
      }

      const addSingleUser = (user) => {
        upsertGrant(user)
      }

      const searchAndAddUser = async () => {
        const kw = (searchKeyword.value || '').trim()
        if (!kw) {
          ElMessage.warning('请输入用户名 / 姓名 / 手机号')
          return
        }
        try {
          const res = await searchMemberUser({ userName: kw })
          const list = res?.data || res?.list || []
          if (!list.length) {
            ElMessage.warning('未找到用户')
            return
          }
          for (const u of list) {
            upsertGrant(u)
          }
          ElMessage.success(`已加入 ${list.length} 名用户`)
        } catch (e) {
          console.error(e)
          ElMessage.error('搜索用户失败')
        }
      }

      const removeGrant = (memberUserId) => {
        grants.value = grants.value.filter(
          (g) => String(g.memberUserId) !== String(memberUserId),
        )
      }

      /** 打开写权限时自动打开「可用」，避免授权矛盾 */
      const onWriteFlagChange = (row, _kind, v) => {
        if (v === 1) {
          row.canUse = 1
        }
      }

      const saveAuth = async () => {
        if (!authDbConfigId.value) return
        authSaving.value = true
        try {
          await replaceDbConfigUsers({
            dbConfigId: authDbConfigId.value,
            grants: grants.value.map((g) => ({
              memberUserId: g.memberUserId,
              canUse: g.canUse ? 1 : 0,
              canEditCanvas: g.canEditCanvas ? 1 : 0,
              canWriteData: g.canWriteData ? 1 : 0,
              canWriteSchema: g.canWriteSchema ? 1 : 0,
            })),
          })
          ElMessage.success('授权已保存')
          authVisible.value = false
        } catch (e) {
          console.error(e)
          ElMessage.error('保存授权失败')
        } finally {
          authSaving.value = false
        }
      }

      const queryData = () => {
        queryForm.pageNum = 1
        getList()
      }

      const handleSizeChange = (val) => {
        queryForm.pageSize = val
        getList()
      }

      const handleCurrentChange = (val) => {
        queryForm.pageNum = val
        getList()
      }

      /** 卡片展示：主机:端口 */
      const hostText = (row) => {
        if (!row?.dbHost) return '—'
        return row.dbPort ? `${row.dbHost}:${row.dbPort}` : String(row.dbHost)
      }

      /** 卡片展示：数据库类型中文名 */
      const typeLabel = (row) => resolveDbType(row?.dbType).label

      const initParams = async () => {
        const { data } = await getVqDict()
        dataBaseType.value = data.dataBaseType
      }

      onMounted(() => {
        initParams()
        getList()
      })

      return {
        loading,
        dialogVisible,
        dialogType,
        formRef,
        form,
        rules,
        queryForm,
        totalNum,
        tableData,
        dataBaseType,
        testConnectionMethod,
        handleAdd,
        handleEdit,
        handleDelete,
        handleCanvas,
        handleRelationCanvas,
        handleSubmit,
        handleSizeChange,
        handleCurrentChange,
        queryData,
        openAuthDialog,
        authVisible,
        authSaving,
        authDbName,
        memberGroups,
        selectedGroupId,
        groupUsers,
        grants,
        searchKeyword,
        onSelectGroup,
        addGroupAllUsers,
        addSingleUser,
        searchAndAddUser,
        removeGrant,
        onWriteFlagChange,
        saveAuth,
        sshAuthMode,
        hostText,
        typeLabel,
        Plus,
        Search,
      }
    },
  })
</script>

<template>
  <div class="db-config-container" v-loading="loading">
    <div class="db-config-toolbar">
      <div class="db-config-toolbar__left">
        <h2 class="db-config-title">数据库连接</h2>
        <p class="db-config-desc">以卡片管理各数据源，支持测试、授权与画布。</p>
      </div>
      <div class="db-config-toolbar__right">
        <el-input
          v-model.trim="queryForm.dbName"
          clearable
          class="db-config-search"
          placeholder="搜索数据库名称"
          @keyup.enter="queryData"
        />
        <el-button
          type="primary"
          v-permissions="{ permission: ['DbConfig:list'] }"
          @click="queryData"
        >
          <el-icon class="el-icon--left"><Search /></el-icon>
          查询
        </el-button>
        <el-button
          v-permissions="{ permission: ['DbConfig:add'] }"
          type="primary"
          @click="handleAdd"
        >
          <el-icon class="el-icon--left"><Plus /></el-icon>
          新增连接
        </el-button>
      </div>
    </div>

    <div v-if="!loading && tableData.length === 0" class="db-config-empty">
      <p>暂无数据库连接</p>
      <p class="db-config-empty__hint">点击下方按钮或右上角「新增连接」创建第一条连接。</p>
      <el-button
        v-permissions="{ permission: ['DbConfig:add'] }"
        type="primary"
        @click="handleAdd"
      >
        <el-icon class="el-icon--left"><Plus /></el-icon>
        新增连接
      </el-button>
    </div>

    <div v-else class="db-card-grid">
      <!-- 新增方片：常驻入口 -->
      <button
        v-permissions="{ permission: ['DbConfig:add'] }"
        type="button"
        class="db-card db-card--add"
        @click="handleAdd"
      >
        <span class="db-card-add__icon" aria-hidden="true">+</span>
        <span class="db-card-add__text">新增连接</span>
      </button>

      <article
        v-for="row in tableData"
        :key="row.id"
        class="db-card"
        :class="{ 'is-offline': row.connectionStatus !== 1 }"
      >
        <header class="db-card__header">
          <div class="db-card__title-row">
            <h3 class="db-card__name" :title="row.dbName">
              {{ row.dbName || '未命名' }}
            </h3>
            <span class="db-card__type">{{ typeLabel(row) }}</span>
          </div>
          <div class="db-card__badges">
            <span
              class="db-card__status"
              :class="row.connectionStatus === 1 ? 'is-online' : 'is-offline'"
            >
              <i class="db-card__dot" />
              {{ row.connectionStatus === 1 ? '在线' : '离线' }}
            </span>
            <el-tag
              :type="row.isPublic === 1 ? 'success' : 'info'"
              size="small"
              effect="plain"
            >
              {{ row.isPublic === 1 ? '公开' : '私有' }}
            </el-tag>
            <el-tag v-if="row.sshEnabled === 1" size="small" type="warning" effect="plain">
              SSH
            </el-tag>
          </div>
        </header>

        <div class="db-card__body">
          <div class="db-card__meta" :title="hostText(row)">
            <span class="db-card__label">主机</span>
            <span class="db-card__value">{{ hostText(row) }}</span>
          </div>
          <div v-if="row.schemaName" class="db-card__meta" :title="row.schemaName">
            <span class="db-card__label">库名</span>
            <span class="db-card__value">{{ row.schemaName }}</span>
          </div>
          <div v-if="row.username" class="db-card__meta" :title="row.username">
            <span class="db-card__label">用户</span>
            <span class="db-card__value">{{ row.username }}</span>
          </div>
          <p
            v-if="row.description"
            class="db-card__desc"
            :title="row.description"
          >
            {{ row.description }}
          </p>
          <p v-if="row.lastCheckTime" class="db-card__time">
            最近检查 {{ row.lastCheckTime }}
          </p>
        </div>

        <footer class="db-card__actions">
          <el-button
            v-permissions="{ permission: ['DataBaseOperate:test'] }"
            link
            type="primary"
            @click="testConnectionMethod(row)"
          >
            测试
          </el-button>
          <el-button
            v-permissions="{ permission: ['DbConfig:update'] }"
            link
            type="primary"
            @click="handleEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permissions="{ permission: ['DbConfigUser:update'] }"
            link
            type="primary"
            @click="openAuthDialog(row)"
          >
            权限
          </el-button>
          <el-dropdown trigger="click">
            <el-button link type="primary">
              更多
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-permissions="{ permission: ['TableGroup:list'] }"
                  @click="handleCanvas(row)"
                >
                  表分组
                </el-dropdown-item>
                <el-dropdown-item
                  v-permissions="{ permission: ['TableRelationship:info'] }"
                  @click="handleRelationCanvas(row)"
                >
                  关系画布
                </el-dropdown-item>
                <el-dropdown-item
                  v-permissions="{ permission: ['DbConfig:delete'] }"
                  divided
                  @click="handleDelete(row)"
                >
                  <span class="db-card__danger">删除</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </footer>
      </article>
    </div>

    <div v-if="totalNum > 0" class="db-config-pagination">
      <el-pagination
        background
        :current-page="queryForm.pageNum"
        layout="total, sizes, prev, pager, next"
        :page-size="queryForm.pageSize"
        :page-sizes="[12, 24, 48]"
        :total="totalNum"
        @current-change="handleCurrentChange"
        @size-change="handleSizeChange"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? '新增配置' : '编辑配置'"
      width="900px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="150px">
        <el-form-item label="数据库中文名称" prop="dbName">
          <el-input v-model="form.dbName" placeholder="请输入数据库中文名称" />
        </el-form-item>
        <el-form-item label="默认数据库" prop="schemaName">
          <el-input v-model="form.schemaName" placeholder="请输入默认数据库" />
        </el-form-item>
        <el-form-item label="数据库类型" prop="dbType">
          <el-select v-model="form.dbType" placeholder="请选择数据库类型">
            <el-option
              v-for="item in dataBaseType"
              :key="item.code"
              :label="item.label"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="主机地址" prop="dbHost">
          <el-input v-model="form.dbHost" placeholder="请输入主机地址" />
        </el-form-item>
        <el-form-item label="端口" prop="dbPort">
          <el-input-number v-model="form.dbPort" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="连接URL" prop="jdbcUrl">
          <el-input v-model="form.jdbcUrl" placeholder="请输入JDBC连接URL" />
        </el-form-item>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="dialogType === 'edit' ? '留空则不修改密码' : '请输入密码'"
            show-password
          />
        </el-form-item>
        <el-divider content-position="left">SSH 隧道（可选）</el-divider>
        <el-form-item label="启用 SSH">
          <el-switch
            v-model="form.sshEnabled"
            :active-value="1"
            :inactive-value="0"
          />
        </el-form-item>
        <template v-if="form.sshEnabled === 1">
          <el-form-item label="SSH 主机">
            <el-input v-model="form.sshHost" placeholder="跳板机地址" />
          </el-form-item>
          <el-form-item label="SSH 端口">
            <el-input-number v-model="form.sshPort" :min="1" :max="65535" />
          </el-form-item>
          <el-form-item label="SSH 用户">
            <el-input v-model="form.sshUsername" />
          </el-form-item>
          <el-form-item label="SSH 认证">
            <el-radio-group v-model="sshAuthMode">
              <el-radio value="password">密码</el-radio>
              <el-radio value="key">私钥</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="sshAuthMode === 'password'" label="SSH 密码">
            <el-input
              v-model="form.sshPassword"
              type="password"
              show-password
              :placeholder="dialogType === 'edit' ? '留空则不修改' : ''"
            />
          </el-form-item>
          <template v-else>
            <el-form-item label="SSH 私钥">
              <el-input
                v-model="form.sshPrivateKey"
                type="textarea"
                :rows="4"
                placeholder="PEM 私钥；留空则不修改"
              />
            </el-form-item>
            <el-form-item label="私钥口令">
              <el-input
                v-model="form.sshPassphrase"
                type="password"
                show-password
                placeholder="可选"
              />
            </el-form-item>
          </template>
        </template>
        <el-form-item label="是否公开">
          <el-switch
            v-model="form.isPublic"
            :active-value="1"
            :inactive-value="0"
            active-text="公开库"
            inactive-text="私有库"
          />
          <div style="font-size: 12px; color: var(--el-text-color-secondary)">
            公开：登录用户可使用（默认不可改画布）；私有：仅所有者/管理员与授权用户
          </div>
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入描述"
          />
        </el-form-item>
        <el-form-item label="排序" prop="orderNum">
          <el-input-number v-model="form.orderNum" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 权限分配：会员组批量勾选 + 授权表 -->
    <el-dialog
      v-model="authVisible"
      :title="`权限分配 — ${authDbName}`"
      width="1080px"
      destroy-on-close
    >
      <div class="auth-layout">
        <div class="auth-left">
          <div class="auth-section-title">会员组</div>
          <el-select
            v-model="selectedGroupId"
            placeholder="选择会员组"
            filterable
            clearable
            style="width: 100%; margin-bottom: 8px"
            @change="onSelectGroup"
          >
            <el-option
              v-for="g in memberGroups"
              :key="g.id"
              :label="g.groupName"
              :value="g.id"
            />
          </el-select>
          <el-button
            type="primary"
            size="small"
            :disabled="!groupUsers.length"
            @click="addGroupAllUsers"
          >
            勾选本组全部用户（{{ groupUsers.length }}）
          </el-button>
          <el-table
            v-if="groupUsers.length"
            :data="groupUsers"
            border
            size="small"
            max-height="220"
            style="margin-top: 8px"
          >
            <el-table-column prop="userName" label="用户名" min-width="90" />
            <el-table-column prop="realName" label="姓名" min-width="80" />
            <el-table-column label="" width="56" align="center">
              <template #default="{ row }">
                <el-button link type="primary" @click="addSingleUser(row)">加入</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-else-if="selectedGroupId"
            description="该组暂无会员"
            :image-size="48"
          />
          <el-divider />
          <div class="auth-section-title">搜索用户加入</div>
          <el-input
            v-model="searchKeyword"
            placeholder="用户名 / 姓名 / 手机号"
            size="small"
            clearable
            @keyup.enter="searchAndAddUser"
          >
            <template #append>
              <el-button @click="searchAndAddUser">搜索</el-button>
            </template>
          </el-input>
        </div>
        <div class="auth-right">
          <div class="auth-section-title">
            已授权用户
            <span class="auth-hint">可用=只读；写数据=增改删行；改结构=建删改表；建库仅所有者</span>
          </div>
          <el-table :data="grants" border size="small" max-height="420">
            <el-table-column prop="userName" label="用户名" min-width="100" />
            <el-table-column prop="realName" label="姓名" min-width="90" />
            <el-table-column label="可用" width="70" align="center">
              <template #default="{ row }">
                <el-switch v-model="row.canUse" :active-value="1" :inactive-value="0" />
              </template>
            </el-table-column>
            <el-table-column label="写数据" width="80" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canWriteData"
                  :active-value="1"
                  :inactive-value="0"
                  @change="(v) => onWriteFlagChange(row, 'data', v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="改结构" width="80" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canWriteSchema"
                  :active-value="1"
                  :inactive-value="0"
                  @change="(v) => onWriteFlagChange(row, 'schema', v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="可改画布" width="90" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canEditCanvas"
                  :active-value="1"
                  :inactive-value="0"
                  @change="(v) => onWriteFlagChange(row, 'canvas', v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" align="center">
              <template #default="{ row }">
                <el-button link type="danger" @click="removeGrant(row.memberUserId)">
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="authVisible = false">取消</el-button>
        <el-button type="primary" :loading="authSaving" @click="saveAuth">保存授权</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
  .db-config-container {
    display: flex;
    flex-direction: column;
    padding: 20px 24px 28px;
    min-height: 100%;
    box-sizing: border-box;
  }

  .db-config-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }

  .db-config-title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--el-text-color-primary);
  }

  .db-config-desc {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  .db-config-toolbar__right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .db-config-search {
    width: min(240px, 100%);
  }

  .db-config-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 16px;
    text-align: center;
    color: var(--el-text-color-secondary);
  }

  .db-config-empty__hint {
    margin: 8px 0 20px;
    font-size: 13px;
    color: var(--el-text-color-placeholder);
  }

  .db-card-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
    align-content: start;
  }

  .db-card {
    display: flex;
    flex-direction: column;
    min-height: 220px;
    padding: 16px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 12px;
    background:
      linear-gradient(
        165deg,
        var(--el-fill-color-blank) 0%,
        var(--el-bg-color) 48%,
        var(--el-fill-color-lighter) 100%
      );
    box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }

  .db-card:hover {
    border-color: var(--el-color-primary-light-5);
    box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
    transform: translateY(-2px);
  }

  .db-card.is-offline {
    opacity: 0.92;
  }

  .db-card--add {
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    color: var(--el-color-primary);
    border-style: dashed;
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9);
    font: inherit;
  }

  .db-card--add:hover {
    background: var(--el-color-primary-light-8);
    border-color: var(--el-color-primary);
  }

  .db-card--add:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
  }

  .db-card-add__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    font-size: 32px;
    font-weight: 300;
    line-height: 1;
    color: var(--el-color-primary);
    background: var(--el-bg-color);
    border: 1px solid var(--el-color-primary-light-7);
    user-select: none;
  }

  .db-card-add__text {
    font-size: 15px;
    font-weight: 600;
  }

  .db-card__header {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .db-card__title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .db-card__name {
    margin: 0;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .db-card__type {
    flex-shrink: 0;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 1.4;
    border-radius: 999px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .db-card__badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .db-card__status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 8px;
    font-size: 12px;
    border-radius: 999px;
    background: var(--el-fill-color);
    color: var(--el-text-color-regular);
  }

  .db-card__status.is-online {
    color: var(--el-color-success);
    background: var(--el-color-success-light-9);
  }

  .db-card__status.is-offline {
    color: var(--el-color-danger);
    background: var(--el-color-danger-light-9);
  }

  .db-card__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .db-card__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 14px;
    min-width: 0;
  }

  .db-card__meta {
    display: flex;
    gap: 8px;
    font-size: 13px;
    line-height: 1.4;
    min-width: 0;
  }

  .db-card__label {
    flex-shrink: 0;
    width: 32px;
    color: var(--el-text-color-placeholder);
  }

  .db-card__value {
    min-width: 0;
    color: var(--el-text-color-regular);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .db-card__desc {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .db-card__time {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  .db-card__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--el-border-color-extra-light);
  }

  .db-card__danger {
    color: var(--el-color-danger);
  }

  .db-config-pagination {
    display: flex;
    justify-content: center;
    margin-top: auto;
    padding-top: 28px;
  }

  .db-config-pagination :deep(.el-pagination) {
    flex-wrap: wrap;
    justify-content: center;
    row-gap: 8px;
  }

  .auth-layout {
    display: flex;
    gap: 16px;
    min-height: 360px;
  }

  .auth-left {
    width: 280px;
    flex-shrink: 0;
  }

  .auth-right {
    flex: 1;
    min-width: 0;
  }

  .auth-section-title {
    margin-bottom: 8px;
    font-weight: 600;
  }

  .auth-hint {
    margin-left: 8px;
    font-size: 12px;
    font-weight: 400;
    color: var(--el-text-color-secondary);
  }
</style>
