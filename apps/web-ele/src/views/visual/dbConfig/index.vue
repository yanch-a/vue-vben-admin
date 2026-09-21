<script>
  /**
   * 数据库连接配置：方片化管理；公开性、密码留空不改、会员授权分配
   * @author yanch
   */
  import { computed, defineComponent, inject, onMounted, reactive, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'

  import { getMemberUser } from '@/api/member/memberUser'
  import { getTableTree, testConnection } from '@/api/visual/database'
  import {
    deleteDbConfig,
    editDbConfig,
    getDbConfigById,
    getDbConfigPage,
    getVqDict,
    listDbConfigUsers,
    listDbTableGrants,
    listMemberUserGroups,
    replaceDbConfigUsers,
    replaceDbTableGrants,
    searchDbConfigUserCandidates,
  } from '@/api/visual/vq'
  import { Plus, Search } from '@element-plus/icons-vue'
  import { ElMessage, ElMessageBox } from 'element-plus'

  import { useConnectionStore } from '../client/composables/useConnectionStore'
  import { setPendingSavedQueryOpen } from '../client/composables/usePendingSavedQuery'
  import { visualClientConfig } from '../client/config'
  import { resolveDbType } from '../client/dialect/dbTypes'

  export default defineComponent({
    name: 'DbConfig',
    setup() {
      const router = useRouter()
      const { openConnections, openConnection, setActiveConnection } =
        useConnectionStore()
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
        // 默认数据库可选：留空时后端按库类型用维护库/无库名 URL
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
      const candidateUsers = ref([])
      const candidateLoading = ref(false)
      /** { memberUserId, userName, realName, canUse, canWriteData, canWriteSchema, canEditCanvas } */
      const grants = ref([])
      const searchKeyword = ref('')
      const tableGrants = ref([])
      const authBaselineUserIds = ref([])
      const authBaselineTableKeys = ref([])
      const tableAuthMode = computed(() => (tableGrants.value && tableGrants.value.length ? 'WHITELIST' : 'OPEN'))
      const tableCandidates = ref([])
      const tableCandidatesLoading = ref(false)
      const tableInstanceName = ref('')
      const tableSubjectType = ref('USER')
      const tableSubjectId = ref(null)
      watch(tableSubjectType, () => {
        tableSubjectId.value = null
      })
      const tableUserOptions = computed(() => {
        const values = [...grants.value, ...candidateUsers.value]
        return Array.from(new Map(values.map((user) => [String(user.memberUserId || user.id), user])).values())
      })

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

      /**
       * 打开 SQL 客户端：复用已打开连接，否则拉配置新开，再进入编辑器
       */
      const handleOpenClient = async (row) => {
        if (!row?.id) return
        const existed = openConnections.value.find(
          (c) => String(c.id) === String(row.id),
        )
        if (existed) {
          setActiveConnection(existed.sessionId)
        } else {
          try {
            const res = await getDbConfigById({ id: row.id })
            const cfg = res?.data || res
            if (!cfg?.id) {
              ElMessage.error('连接配置不存在或无权访问')
              return
            }
            if (cfg.connectionStatus === 0) {
              ElMessage.warning('该连接已禁用，无法打开')
              return
            }
            const result = openConnection({
              id: cfg.id,
              dbName: cfg.dbName,
              schemaName: cfg.schemaName,
              dbType: cfg.dbType,
              dbHost: cfg.dbHost,
              dbPort: cfg.dbPort,
              username: cfg.username,
              description: cfg.description,
              connectionStatus: cfg.connectionStatus,
              aiEnabled: cfg.aiEnabled == null ? 1 : Number(cfg.aiEnabled),
              aiAllowSampleData:
                cfg.aiAllowSampleData == null
                  ? 0
                  : Number(cfg.aiAllowSampleData),
            })
            if (!result.ok) {
              if (result.reason === 'max') {
                ElMessage.warning(
                  `最多同时打开 ${visualClientConfig.maxOpenConnections} 个数据库连接，请先关闭其它连接`,
                )
              }
              return
            }
          } catch (error) {
            console.error('打开连接失败:', error)
            ElMessage.error(error?.msg || error?.message || '打开连接失败')
            return
          }
        }

        setPendingSavedQueryOpen({
          queryName: row.dbName || '查询',
          sqlText: '',
          instanceName: row.schemaName || '',
          dbConfigId: row.id,
        })
        router.push({ name: 'VisualClient' })
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
        tableSubjectType.value = 'USER'
        tableSubjectId.value = null
        authVisible.value = true
        selectedGroupId.value = null
        candidateUsers.value = []
        searchKeyword.value = ''
        try {
          tableInstanceName.value = row.schemaName || ''
          const [{ data: groups }, { data: existing }, { data: existingTables }] = await Promise.all([
            listMemberUserGroups(),
            listDbConfigUsers(row.id),
            listDbTableGrants(row.id),
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
          tableGrants.value = existingTables || []
          authBaselineUserIds.value = grants.value.map((g) => String(g.memberUserId))
          authBaselineTableKeys.value = tableGrants.value.map(
            (g) => [g.subjectType, g.subjectId, g.instanceName, g.tableName].join(':'),
          )
          await enrichGrantNames(grants.value)
          if (tableInstanceName.value) await loadTableCandidates()
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

      const isGranted = (user) => {
        const id = user?.id || user?.memberUserId
        return Boolean(id) && grants.value.some(
          (g) => String(g.memberUserId) === String(id),
        )
      }

      const searchUsers = async () => {
        candidateLoading.value = true
        try {
          const keyword = (searchKeyword.value || '').trim()
          const res = await searchDbConfigUserCandidates(authDbConfigId.value, {
            keyword: keyword || undefined,
            groupId: selectedGroupId.value || undefined,
          })
          const list = res?.data || res?.list || []
          candidateUsers.value = Array.isArray(list)
            ? list.filter((user) => user?.id || user?.memberUserId)
            : []
          if (!candidateUsers.value.length) ElMessage.info('没有找到匹配的用户')
        } catch (e) {
          console.error(e)
          candidateUsers.value = []
          ElMessage.error('搜索用户失败')
        } finally {
          candidateLoading.value = false
        }
      }

      const onSelectGroup = () => searchUsers()

      /** 从目标数据库实时加载表，确保 PG/达梦等类型使用实际元数据。 */
      const loadTableCandidates = async () => {
        if (!authDbConfigId.value || !tableInstanceName.value.trim()) {
          tableCandidates.value = []
          return ElMessage.warning('请先填写数据库 / Schema 名称')
        }
        tableCandidatesLoading.value = true
        try {
          const { data } = await getTableTree(authDbConfigId.value, tableInstanceName.value.trim())
          tableCandidates.value = (data || []).flatMap((schema) =>
            (schema.tables || []).map((table) => ({
              ...table,
              schemaName: table.schemaName || schema.schemaName,
              qualifiedName: table.qualifiedName || table.tableName,
            })),
          )
        } catch (e) {
          console.error(e)
          tableCandidates.value = []
          ElMessage.error('加载数据库表失败')
        } finally {
          tableCandidatesLoading.value = false
        }
      }

      const tableSubjectLabel = (row) => {
        if (row.subjectType === 'DEPT') {
          return memberGroups.value.find((g) => String(g.id) === String(row.subjectId))?.groupName || `部门 ${row.subjectId}`
        }
        const user = tableUserOptions.value.find((g) => String(g.memberUserId || g.id) === String(row.subjectId))
        return user?.realName || user?.userName || `用户 ${row.subjectId}`
      }

      const addTableGrant = (table) => {
        if (!tableSubjectId.value) return ElMessage.warning('请先选择用户或部门')
        const instanceName = tableInstanceName.value.trim()
        const duplicate = tableGrants.value.some((row) => row.subjectType === tableSubjectType.value
          && String(row.subjectId) === String(tableSubjectId.value)
          && String(row.instanceName).toLowerCase() === instanceName.toLowerCase()
          && String(row.tableName).toLowerCase() === String(table.qualifiedName || table.tableName).toLowerCase())
        if (duplicate) return ElMessage.info('该表已在授权列表中')
        tableGrants.value.push({
          subjectType: tableSubjectType.value,
          subjectId: tableSubjectId.value,
          instanceName,
          // 始终保存 schema/owner 限定名，避免 public 与其它命名空间同名表发生串权。
          tableName: table.qualifiedName || table.tableName,
          canRead: 1,
          canWriteData: 0,
          canWriteSchema: 0,
        })
      }

      const removeTableGrant = (index) => tableGrants.value.splice(index, 1)

      const addGrant = (user, defaults = {}) => {
        const id = user.id || user.memberUserId
        if (!id || isGranted(user)) return false
        const row = {
          memberUserId: id,
          userName: user.userName || user.username || String(id),
          realName: user.realName || '',
          canUse: defaults.canUse != null ? defaults.canUse : 1,
          canEditCanvas: defaults.canEditCanvas != null ? defaults.canEditCanvas : 0,
          canWriteData: defaults.canWriteData != null ? defaults.canWriteData : 0,
          canWriteSchema: defaults.canWriteSchema != null ? defaults.canWriteSchema : 0,
        }
        grants.value.push(row)
        return true
      }

      const addSingleUser = (user) => {
        if (!addGrant(user)) return ElMessage.info('该用户已在授权列表中')
        ElMessage.success(`已加入 ${user.realName || user.userName || '用户'}`)
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
        const uniqueGrants = Array.from(
          new Map(grants.value.map((g) => [String(g.memberUserId), g])).values(),
        )
        const newUserIds = uniqueGrants.map((g) => String(g.memberUserId))
        const newTableKeys = tableGrants.value.map(
          (g) => `${g.subjectType}:${g.subjectId}:${g.instanceName}:${g.tableName}`,
        )
        const removedUsers = (authBaselineUserIds.value || []).filter((id) => !newUserIds.includes(id))
        const removedTables = (authBaselineTableKeys.value || []).filter((k) => !newTableKeys.includes(k))
        const clearingUsers = uniqueGrants.length === 0 && (authBaselineUserIds.value || []).length > 0
        const clearingTables = tableGrants.value.length === 0 && (authBaselineTableKeys.value || []).length > 0
        if (clearingUsers || clearingTables || removedUsers.length || removedTables.length) {
          const lines = []
          if (clearingUsers) lines.push('将清空全部连接级成员授权')
          else if (removedUsers.length) lines.push(`将移除 ${removedUsers.length} 个已授权用户`)
          if (clearingTables) lines.push('将清空全部表级授权（恢复为开放模式）')
          else if (removedTables.length) lines.push(`将移除 ${removedTables.length} 条表级授权`)
          try {
            await ElMessageBox.confirm(
              lines.join('；') + '。确定保存？',
              '授权变更确认',
              { type: 'warning', confirmButtonText: '确定保存', cancelButtonText: '取消' },
            )
          } catch {
            return
          }
        }
        authSaving.value = true
        try {
          await replaceDbConfigUsers({
            dbConfigId: authDbConfigId.value,
            grants: uniqueGrants.map((g) => ({
              memberUserId: g.memberUserId,
              canUse: g.canUse ? 1 : 0,
              canEditCanvas: g.canEditCanvas ? 1 : 0,
              canWriteData: g.canWriteData ? 1 : 0,
              canWriteSchema: g.canWriteSchema ? 1 : 0,
            })),
          })
          await replaceDbTableGrants({
            dbConfigId: authDbConfigId.value,
            grants: tableGrants.value.map((g) => ({
              subjectType: g.subjectType,
              subjectId: g.subjectId,
              instanceName: g.instanceName,
              tableName: g.tableName,
              canRead: g.canRead ? 1 : 0,
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
        handleOpenClient,
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
        candidateUsers,
        candidateLoading,
        grants,
        searchKeyword,
        onSelectGroup,
        addSingleUser,
        isGranted,
        searchUsers,
        removeGrant,
        onWriteFlagChange,
        saveAuth,
        tableGrants,
        tableCandidates,
        tableCandidatesLoading,
        tableInstanceName,
        tableSubjectType,
        tableSubjectId,
        tableUserOptions,
        loadTableCandidates,
        tableSubjectLabel,
        addTableGrant,
        removeTableGrant,
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
        <div class="db-config-title-row">
          <h2 class="db-config-title">{{ $tr('数据库连接') }}</h2>
          <el-button
            v-permissions="{ permission: ['DbConfig:add'] }"
            type="primary"
            @click="handleAdd"
          >
            <el-icon class="el-icon--left"><Plus /></el-icon>
            {{ $tr('新增连接') }}
          </el-button>
        </div>
        <p class="db-config-desc">{{ $tr('以卡片管理各数据源，支持测试、授权与画布。') }}</p>
      </div>
      <div class="db-config-toolbar__right">
        <el-input
          v-model.trim="queryForm.dbName"
          clearable
          class="db-config-search"
          :placeholder="$tr('搜索数据库名称')"
          @keyup.enter="queryData"
        />
        <el-button
          type="primary"
          v-permissions="{ permission: ['DbConfig:list'] }"
          @click="queryData"
        >
          <el-icon class="el-icon--left"><Search /></el-icon>
          {{ $tr('查询') }}
        </el-button>
      </div>
    </div>

    <div v-if="!loading && tableData.length === 0" class="db-config-empty">
      <p>{{ $tr('暂无数据库连接') }}</p>
      <p class="db-config-empty__hint">{{ $tr('点击下方按钮或标题旁「新增连接」创建第一条连接。') }}</p>
      <el-button
        v-permissions="{ permission: ['DbConfig:add'] }"
        type="primary"
        @click="handleAdd"
      >
        <el-icon class="el-icon--left"><Plus /></el-icon>
        {{ $tr('新增连接') }}
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
        <span class="db-card-add__text">{{ $tr('新增连接') }}</span>
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
              {{ $tr(row.dbName || '未命名') }}
            </h3>
            <span class="db-card__type">{{ typeLabel(row) }}</span>
          </div>
          <div class="db-card__badges">
            <span
              class="db-card__status"
              :class="row.connectionStatus === 1 ? 'is-online' : 'is-offline'"
            >
              <i class="db-card__dot"></i>
              {{ $tr(row.connectionStatus === 1 ? '在线' : '离线') }}
            </span>
            <el-tag
              :type="row.isPublic === 1 ? 'success' : 'info'"
              size="small"
              effect="plain"
            >
              {{ $tr(row.isPublic === 1 ? '公开' : '私有') }}
            </el-tag>
            <el-tag v-if="row.sshEnabled === 1" size="small" type="warning" effect="plain">
              SSH
            </el-tag>
          </div>
        </header>

        <div class="db-card__body">
          <div class="db-card__meta" :title="hostText(row)">
            <span class="db-card__label">{{ $tr('主机') }}</span>
            <span class="db-card__value">{{ hostText(row) }}</span>
          </div>
          <div v-if="row.schemaName" class="db-card__meta" :title="row.schemaName">
            <span class="db-card__label">{{ $tr('库名') }}</span>
            <span class="db-card__value">{{ row.schemaName }}</span>
          </div>
          <div v-if="row.username" class="db-card__meta" :title="row.username">
            <span class="db-card__label">{{ $tr('用户') }}</span>
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
            {{ $tr('最近检查') }} {{ row.lastCheckTime }}
          </p>
        </div>

        <footer class="db-card__actions">
          <el-button
            link
            type="primary"
            @click="handleOpenClient(row)"
          >
            {{ $tr('打开') }}
          </el-button>
          <el-button
            v-permissions="{ permission: ['DataBaseOperate:test'] }"
            link
            type="primary"
            @click="testConnectionMethod(row)"
          >
            {{ $tr('测试') }}
          </el-button>
          <el-button
            v-permissions="{ permission: ['DbConfig:update'] }"
            link
            type="primary"
            @click="handleEdit(row)"
          >
            {{ $tr('编辑') }}
          </el-button>
          <el-button
            v-permissions="{ permission: ['DbConfigUser:update'] }"
            link
            type="primary"
            @click="openAuthDialog(row)"
          >
            {{ $tr('权限') }}
          </el-button>
          <el-dropdown trigger="click">
            <el-button link type="primary">
              {{ $tr('更多') }}
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-permissions="{ permission: ['TableGroup:list'] }"
                  @click="handleCanvas(row)"
                >
                  {{ $tr('表分组') }}
                </el-dropdown-item>
                <el-dropdown-item
                  v-permissions="{ permission: ['TableRelationship:info'] }"
                  @click="handleRelationCanvas(row)"
                >
                  {{ $tr('关系画布') }}
                </el-dropdown-item>
                <el-dropdown-item
                  v-permissions="{ permission: ['DbConfig:delete'] }"
                  divided
                  @click="handleDelete(row)"
                >
                  <span class="db-card__danger">{{ $tr('删除') }}</span>
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
        <el-form-item :label="$tr('数据库中文名称')" prop="dbName">
          <el-input v-model="form.dbName" :placeholder="$tr('请输入数据库中文名称')" />
        </el-form-item>
        <el-form-item :label="$tr('默认数据库')" prop="schemaName">
          <el-input
            v-model="form.schemaName"
            :placeholder="$tr('可选，如 MySQL 库名 / PG database；留空则连服务器后自选')"
          />
        </el-form-item>
        <el-form-item :label="$tr('数据库类型')" prop="dbType">
          <el-select v-model="form.dbType" :placeholder="$tr('请选择数据库类型')">
            <el-option
              v-for="item in dataBaseType"
              :key="item.code"
              :label="item.label"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="$tr('主机地址')" prop="dbHost">
          <el-input v-model="form.dbHost" :placeholder="$tr('请输入主机地址')" />
        </el-form-item>
        <el-form-item :label="$tr('端口')" prop="dbPort">
          <el-input-number v-model="form.dbPort" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item :label="$tr('连接URL')" prop="jdbcUrl">
          <el-input v-model="form.jdbcUrl" :placeholder="$tr('请输入JDBC连接URL')" />
        </el-form-item>
        <el-form-item :label="$tr('用户名')" prop="username">
          <el-input v-model="form.username" :placeholder="$tr('请输入用户名')" />
        </el-form-item>
        <el-form-item :label="$tr('密码')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="dialogType === 'edit' ? '留空则不修改密码' : '请输入密码'"
            show-password
          />
        </el-form-item>
        <el-divider content-position="left">{{ $tr('SSH 隧道（可选）') }}</el-divider>
        <el-form-item :label="$tr('启用 SSH')">
          <el-switch
            v-model="form.sshEnabled"
            :active-value="1"
            :inactive-value="0"
          />
        </el-form-item>
        <template v-if="form.sshEnabled === 1">
          <el-form-item :label="$tr('SSH 主机')">
            <el-input v-model="form.sshHost" :placeholder="$tr('跳板机地址')" />
          </el-form-item>
          <el-form-item :label="$tr('SSH 端口')">
            <el-input-number v-model="form.sshPort" :min="1" :max="65535" />
          </el-form-item>
          <el-form-item :label="$tr('SSH 用户')">
            <el-input v-model="form.sshUsername" />
          </el-form-item>
          <el-form-item :label="$tr('SSH 认证')">
            <el-radio-group v-model="sshAuthMode">
              <el-radio value="password">{{ $tr('密码') }}</el-radio>
              <el-radio value="key">{{ $tr('私钥') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="sshAuthMode === 'password'" :label="$tr('SSH 密码')">
            <el-input
              v-model="form.sshPassword"
              type="password"
              show-password
              :placeholder="dialogType === 'edit' ? '留空则不修改' : ''"
            />
          </el-form-item>
          <template v-else>
            <el-form-item :label="$tr('SSH 私钥')">
              <el-input
                v-model="form.sshPrivateKey"
                type="textarea"
                :rows="4"
                :placeholder="$tr('PEM 私钥；留空则不修改')"
              />
            </el-form-item>
            <el-form-item :label="$tr('私钥口令')">
              <el-input
                v-model="form.sshPassphrase"
                type="password"
                show-password
                :placeholder="$tr('可选')"
              />
            </el-form-item>
          </template>
        </template>
        <el-form-item :label="$tr('是否公开')">
          <el-switch
            v-model="form.isPublic"
            :active-value="1"
            :inactive-value="0"
            :active-text="$tr('公开库')"
            :inactive-text="$tr('私有库')"
          />
          <div style="font-size: 12px; color: var(--el-text-color-secondary)">
            {{ $tr('公开：登录用户可使用（默认不可改画布）；私有：仅所有者/管理员与授权用户') }}
          </div>
        </el-form-item>
        <el-form-item :label="$tr('描述')" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            :placeholder="$tr('请输入描述')"
          />
        </el-form-item>
        <el-form-item :label="$tr('排序')" prop="orderNum">
          <el-input-number v-model="form.orderNum" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $tr('取消') }}</el-button>
        <el-button type="primary" @click="handleSubmit">{{ $tr('确定') }}</el-button>
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
      <el-alert
        :title="(tableGrants && tableGrants.length) ? '白名单模式：仅可见/可操作已授权表' : '开放模式：未配置表级授权时，连接内表不受表白名单限制（仍受连接 canUse/写标志约束）'"
        :type="(tableGrants && tableGrants.length) ? 'warning' : 'info'"
        show-icon
        :closable="false"
        style="margin-bottom: 8px"
      />
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 8px"
        title="写权限需同时满足：连接级 canWriteData/canWriteSchema 与表级对应标志（白名单模式）；开放模式（无表级授权）仅看连接级标志。用户授权与部门授权取并集，任一允许即可。"
      />

        <div class="auth-left">
          <div class="auth-section-title">{{ $tr('查找用户') }}</div>
          <div class="auth-user-tools">
            <el-input
              v-model="searchKeyword"
              :placeholder="$tr('用户名 / 姓名 / 手机号')"
              clearable
              @clear="searchUsers"
              @keyup.enter="searchUsers"
            />
            <el-select
              v-model="selectedGroupId"
              :placeholder="$tr('全部部门')"
              filterable
              clearable
              @change="onSelectGroup"
            >
              <el-option
                v-for="g in memberGroups"
                :key="g.id"
                :label="g.groupName"
                :value="g.id"
              />
            </el-select>
            <el-button type="primary" :icon="Search" :loading="candidateLoading" @click="searchUsers">
              {{ $tr('搜索') }}
            </el-button>
          </div>
          <el-table
            v-loading="candidateLoading"
            :data="candidateUsers"
            border
            size="small"
            height="330"
            :empty-text="$tr('输入条件搜索用户')"
          >
            <el-table-column prop="userName" :label="$tr('用户名')" min-width="90" />
            <el-table-column prop="realName" :label="$tr('姓名')" min-width="80" />
            <el-table-column :label="$tr('操作')" width="70" align="center">
              <template #default="{ row }">
                <el-button
                  link
                  type="primary"
                  :disabled="isGranted(row)"
                  @click="addSingleUser(row)"
                >
                  {{ $tr(isGranted(row) ? '已加入' : '加入') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="auth-right">
          <div class="auth-section-title">
            {{ $tr('已授权用户') }}
            <span class="auth-hint">{{ $tr('可用=只读；写数据=增改删行；改结构=建删改表；建库仅所有者') }}</span>
          </div>
          <el-table :data="grants" border size="small" max-height="420">
            <el-table-column prop="userName" :label="$tr('用户名')" min-width="100" />
            <el-table-column prop="realName" :label="$tr('姓名')" min-width="90" />
            <el-table-column :label="$tr('可用')" width="70" align="center">
              <template #default="{ row }">
                <el-switch v-model="row.canUse" :active-value="1" :inactive-value="0" />
              </template>
            </el-table-column>
            <el-table-column :label="$tr('写数据')" width="80" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canWriteData"
                  :active-value="1"
                  :inactive-value="0"
                  @change="(v) => onWriteFlagChange(row, 'data', v)"
                />
              </template>
            </el-table-column>
            <el-table-column :label="$tr('改结构')" width="80" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canWriteSchema"
                  :active-value="1"
                  :inactive-value="0"
                  @change="(v) => onWriteFlagChange(row, 'schema', v)"
                />
              </template>
            </el-table-column>
            <el-table-column :label="$tr('可改画布')" width="90" align="center">
              <template #default="{ row }">
                <el-switch
                  v-model="row.canEditCanvas"
                  :active-value="1"
                  :inactive-value="0"
                  @change="(v) => onWriteFlagChange(row, 'canvas', v)"
                />
              </template>
            </el-table-column>
            <el-table-column :label="$tr('操作')" width="70" align="center">
              <template #default="{ row }">
                <el-button link type="danger" @click="removeGrant(row.memberUserId)">
                  {{ $tr('移除') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <el-divider content-position="left">{{ $tr('表级权限（用户与所属部门权限合并）') }}</el-divider>
      <div class="table-auth-tools">
        <el-radio-group v-model="tableSubjectType">
          <el-radio-button value="USER">{{ $tr('用户') }}</el-radio-button>
          <el-radio-button value="DEPT">{{ $tr('部门') }}</el-radio-button>
        </el-radio-group>
        <el-select v-if="tableSubjectType === 'USER'" v-model="tableSubjectId" filterable :placeholder="$tr('选择用户')">
          <el-option v-for="u in tableUserOptions" :key="u.memberUserId || u.id" :label="u.realName || u.userName" :value="u.memberUserId || u.id" />
        </el-select>
        <el-select v-else v-model="tableSubjectId" filterable :placeholder="$tr('选择部门')">
          <el-option v-for="g in memberGroups" :key="g.id" :label="g.groupName" :value="g.id" />
        </el-select>
        <el-input v-model="tableInstanceName" :placeholder="$tr('数据库 / Schema 名称')" @keyup.enter="loadTableCandidates" />
        <el-button :loading="tableCandidatesLoading" @click="loadTableCandidates">{{ $tr('加载表') }}</el-button>
      </div>
      <div class="table-auth-layout">
        <el-table v-loading="tableCandidatesLoading" :data="tableCandidates" border size="small" height="250">
          <el-table-column prop="schemaName" :label="$tr('Schema / Owner')" min-width="110" />
          <el-table-column prop="rawTableName" :label="$tr('可选表')" min-width="150">
            <template #default="{ row }">{{ row.rawTableName || row.tableName }}</template>
          </el-table-column>
          <el-table-column :label="$tr('操作')" width="70" align="center"><template #default="{ row }"><el-button link type="primary" @click="addTableGrant(row)">{{ $tr('加入') }}</el-button></template></el-table-column>
        </el-table>
        <el-table :data="tableGrants" border size="small" height="250">
          <el-table-column :label="$tr('主体')" min-width="110"><template #default="{ row }">{{ tableSubjectLabel(row) }}</template></el-table-column>
          <el-table-column prop="instanceName" :label="$tr('实例')" min-width="100" />
          <el-table-column prop="tableName" :label="$tr('表名')" min-width="120" />
          <el-table-column :label="$tr('读取')" width="64" align="center"><template #default="{ row }"><el-switch v-model="row.canRead" :active-value="1" :inactive-value="0" /></template></el-table-column>
          <el-table-column :label="$tr('写数据')" width="72" align="center"><template #default="{ row }"><el-switch v-model="row.canWriteData" :active-value="1" :inactive-value="0" /></template></el-table-column>
          <el-table-column :label="$tr('改结构')" width="72" align="center"><template #default="{ row }"><el-switch v-model="row.canWriteSchema" :active-value="1" :inactive-value="0" /></template></el-table-column>
          <el-table-column :label="$tr('操作')" width="64" align="center"><template #default="{ $index }"><el-button link type="danger" @click="removeTableGrant($index)">{{ $tr('移除') }}</el-button></template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="authVisible = false">{{ $tr('取消') }}</el-button>
        <el-button type="primary" :loading="authSaving" @click="saveAuth">{{ $tr('保存授权') }}</el-button>
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

  .db-config-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
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
    flex-wrap: nowrap;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
  }

  .db-config-search {
    width: 240px;
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
    width: 360px;
    flex-shrink: 0;
  }

  .auth-user-tools {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 120px auto;
    gap: 8px;
    margin-bottom: 10px;
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

  .table-auth-tools {
    display: grid;
    grid-template-columns: auto minmax(140px, 1fr) minmax(170px, 1fr) auto;
    gap: 8px;
    margin-bottom: 10px;
  }

  .table-auth-layout {
    display: grid;
    grid-template-columns: minmax(260px, 0.7fr) minmax(520px, 1.3fr);
    gap: 12px;
  }

  @media (max-width: 900px) {
    .auth-layout {
      flex-direction: column;
    }

    .auth-left {
      width: 100%;
    }

    .table-auth-tools,
    .table-auth-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
