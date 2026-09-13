<script>
  /**
   * 菜单编辑抽屉：按 Vben 路由类型展示字段，不再保留旧 admin-plus 的来源/无分栏/单模块勾选
   * @author yanch
   */
  import { computed, defineComponent, inject, nextTick, reactive, toRefs } from 'vue'

  import { doEdit, getById, getModules, getTree } from '@/api/menuManagement'
  import IconSelector from '@/components/IconSelector/index.vue'
  import { activeValue } from '@/utils/convert'
  import { InfoFilled } from '@element-plus/icons-vue'

  const KIND_OPTIONS = [
    { key: 'catalog', label: '目录', desc: '侧栏分组，不挂页面' },
    { key: 'page', label: '页面', desc: '对应 views 下的 Vue 文件' },
    { key: 'link', label: '外链', desc: '新窗口打开 http 地址' },
    { key: 'iframe', label: '内嵌', desc: '在系统内嵌外部页面' },
  ]

  function createDefaultForm() {
    return {
      menuType: 'C',
      parentId: 0,
      menuName: '',
      name: '',
      path: '',
      component: '',
      queryParam: '',
      orderNum: 10,
      remark: '',
      icon: '',
      activeIcon: '',
      visible: activeValue.active,
      isCache: activeValue.active,
      isFrame: activeValue.inActive,
      redirect: '',
      activePath: '',
      iframeSrc: '',
      badge: '',
      badgeType: '',
      badgeVariants: '',
      affixTab: activeValue.inActive,
      hideInTab: activeValue.inActive,
      hideInBreadcrumb: activeValue.inActive,
      hideChildrenInMenu: activeValue.inActive,
      openInNewWindow: activeValue.inActive,
      moduleMounts: [],
    }
  }

  function toFlag(val, fallback = activeValue.inActive) {
    if (val === null || val === undefined || val === '') return fallback
    return Number(val)
  }

  function resolveKind(form) {
    if (form.menuType === 'M') return 'catalog'
    if (form.menuType === 'F') return 'button'
    if (Number(form.isFrame) === 1) return 'link'
    if (form.iframeSrc) return 'iframe'
    return 'page'
  }

  function applyKind(form, kind) {
    if (kind === 'catalog') {
      form.menuType = 'M'
      form.isFrame = activeValue.inActive
      form.iframeSrc = ''
      form.component = ''
    } else if (kind === 'link') {
      form.menuType = 'C'
      form.isFrame = activeValue.active
      form.iframeSrc = ''
      form.component = ''
      if (!form.openInNewWindow) form.openInNewWindow = activeValue.active
    } else if (kind === 'iframe') {
      form.menuType = 'C'
      form.isFrame = activeValue.inActive
      form.component = ''
    } else if (kind === 'button') {
      form.menuType = 'F'
      form.isFrame = activeValue.inActive
      form.component = ''
    } else {
      form.menuType = 'C'
      form.isFrame = activeValue.inActive
    }
  }

  /** path 末段转 PascalCase，用作路由 name 初值 */
  function pathToRouteName(path) {
    const raw = String(path || '')
      .replace(/^https?:\/\//i, '')
      .split(/[/?#]/)
      .filter(Boolean)
      .pop()
    if (!raw) return ''
    return raw
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('')
  }

  function normalizeMenuForm(data) {
    const form = { ...createDefaultForm(), ...data }
    form.parentId =
      form.parentId === null || form.parentId === undefined || form.parentId === ''
        ? 0
        : Number(form.parentId)
    form.orderNum = Number(form.orderNum ?? 10)
    form.visible = toFlag(form.visible, activeValue.active)
    form.isCache = toFlag(form.isCache, activeValue.active)
    form.isFrame = toFlag(form.isFrame, activeValue.inActive)
    form.affixTab = toFlag(form.affixTab, activeValue.inActive)
    form.hideInTab = toFlag(form.hideInTab, activeValue.inActive)
    form.hideInBreadcrumb = toFlag(form.hideInBreadcrumb, activeValue.inActive)
    form.hideChildrenInMenu = toFlag(form.hideChildrenInMenu, activeValue.inActive)
    form.openInNewWindow = toFlag(form.openInNewWindow, activeValue.inActive)
    form.redirect = form.redirect || ''
    form.activePath = form.activePath || ''
    form.activeIcon = form.activeIcon || ''
    form.iframeSrc = form.iframeSrc || ''
    form.badge = form.badge || ''
    form.badgeType = form.badgeType || ''
    form.badgeVariants = form.badgeVariants || ''
    form.moduleMounts = Array.isArray(form.moduleMounts)
      ? form.moduleMounts.map((m) => ({
          moduleCode: m.moduleCode,
          operationCodes: Array.isArray(m.operationCodes)
            ? m.operationCodes.map(String)
            : [],
        }))
      : []
    return form
  }

  function normalizeTreeNodes(nodes) {
    if (!Array.isArray(nodes)) return []
    return nodes.map((n) => ({
      ...n,
      menuId: Number(n.menuId),
      parentId:
        n.parentId === null || n.parentId === undefined || n.parentId === ''
          ? 0
          : Number(n.parentId),
      children: normalizeTreeNodes(n.children || []),
    }))
  }

  function collectIds(node, set) {
    set.add(Number(node.menuId))
    ;(node.children || []).forEach((c) => collectIds(c, set))
  }

  function findNode(nodes, id) {
    for (const n of nodes || []) {
      if (Number(n.menuId) === Number(id)) return n
      const hit = findNode(n.children || [], id)
      if (hit) return hit
    }
    return null
  }

  function applyDisabled(nodes, banned) {
    return (nodes || []).map((n) => ({
      ...n,
      disabled: banned.has(Number(n.menuId)),
      children: applyDisabled(n.children || [], banned),
    }))
  }

  export default defineComponent({
    name: 'MenuManagementEdit',
    components: { IconSelector },
    emits: ['fetchData'],
    setup(_props, { emit }) {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        formRef: null,
        treeData: [],
        defaultProps: {
          children: 'children',
          label: 'menuName',
          value: 'menuId',
          disabled: 'disabled',
        },
        form: createDefaultForm(),
        uiType: 'page',
        rules: {
          parentId: [
            { required: true, trigger: 'change', message: '请选择上级菜单' },
          ],
          menuName: [
            { required: true, trigger: 'blur', message: '请输入菜单名称' },
          ],
          name: [
            { required: true, trigger: 'blur', message: '请输入路由 name' },
          ],
          path: [],
          component: [],
          iframeSrc: [],
        },
        title: '',
        visible: false,
        modules: [],
        isEdit: false,
        nameTouched: false,
        mountPickCode: '',
        treeSelectKey: 0,
        saving: false,
        /** 打开弹窗时已落库的挂载快照，用来对比 Controller 里新增的 @Operation */
        originalMounts: {},
      })

      const refreshFieldRules = () => {
        const kind = state.uiType
        state.rules.path = []
        state.rules.component = []
        state.rules.iframeSrc = []
        if (kind === 'page') {
          state.rules.path = [
            { required: true, trigger: 'blur', message: '请输入路由 path' },
          ]
          if (Number(state.form.visible) === activeValue.active) {
            state.rules.component = [
              {
                required: true,
                trigger: 'blur',
                message: '请输入 views 相对路径，如 /visual/client/index',
              },
            ]
          }
        } else if (kind === 'link') {
          state.rules.path = [
            {
              required: true,
              trigger: 'blur',
              validator: (_rule, value, callback) => {
                if (!value || !/^https?:\/\//i.test(String(value))) {
                  callback(new Error('外链必须以 http(s):// 开头'))
                } else {
                  callback()
                }
              },
            },
          ]
        } else if (kind === 'iframe') {
          state.rules.path = [
            { required: true, trigger: 'blur', message: '请输入路由 path' },
          ]
          state.rules.iframeSrc = [
            {
              required: true,
              trigger: 'blur',
              validator: (_rule, value, callback) => {
                if (!value || !/^https?:\/\//i.test(String(value))) {
                  callback(new Error('内嵌地址必须以 http(s):// 开头'))
                } else {
                  callback()
                }
              },
            },
          ]
        } else if (kind === 'catalog' && Number(state.form.parentId) === 0) {
          state.rules.path = [
            { required: true, trigger: 'blur', message: '顶级目录请填写 path，如 /setting' },
          ]
        }
      }

      const setUiType = (kind) => {
        state.uiType = kind
        applyKind(state.form, kind)
        refreshFieldRules()
      }

      const onPathInput = () => {
        if (!state.nameTouched && !state.isEdit) {
          const generated = pathToRouteName(state.form.path)
          if (generated) state.form.name = generated
        }
        if (
          Number(state.form.parentId) === 0 &&
          state.uiType !== 'link' &&
          state.form.path &&
          !String(state.form.path).startsWith('/')
        ) {
          state.form.path = `/${state.form.path}`
        }
      }

      const fetchParentTree = async () => {
        const res = await getTree({ _t: Date.now() })
        const list = normalizeTreeNodes(res?.data?.list ?? res?.list ?? [])
        const banned = new Set()
        if (state.form.menuId) {
          const self = findNode(list, state.form.menuId)
          if (self) collectIds(self, banned)
        }
        state.treeData = [
          {
            menuId: 0,
            parentId: 0,
            menuName: '顶级菜单',
            children: applyDisabled(list, banned),
          },
        ]
        state.treeSelectKey += 1
      }

      const loadModules = async () => {
        const { data } = await getModules()
        state.modules = Array.isArray(data) ? data : []
      }

      /**
       * row 为空：新增顶级；仅有 parentId：在该节点下新增；有 menuId：编辑
       */
      const showEdit = async (row) => {
        state.nameTouched = false
        state.mountPickCode = ''
        if (row?.menuId) {
          state.title = `编辑菜单 · ${row.menuName || ''}`
          const { data } = await getById(row)
          if (!data) {
            $baseMessage('未查到相关数据', 'error')
            return
          }
          state.form = normalizeMenuForm(data)
          state.uiType = resolveKind(state.form)
          state.isEdit = true
          state.nameTouched = true
        } else {
          state.title = row?.parentId ? '新增子菜单' : '新增菜单'
          state.form = createDefaultForm()
          if (row?.parentId != null) {
            state.form.parentId = Number(row.parentId)
          }
          state.uiType = 'page'
          applyKind(state.form, 'page')
          state.isEdit = false
        }
        snapshotOriginalMounts()
        state.visible = true
        state.treeData = []
        await nextTick()
        await Promise.all([fetchParentTree(), loadModules()])
        refreshFieldRules()
      }

      const snapshotOriginalMounts = () => {
        const map = {}
        for (const item of state.form.moduleMounts || []) {
          map[item.moduleCode] = (item.operationCodes || []).map(String)
        }
        state.originalMounts = map
      }

      const close = () => {
        state.formRef?.resetFields?.()
        state.form = createDefaultForm()
        state.visible = false
        state.isEdit = false
        state.saving = false
        state.mountPickCode = ''
        state.uiType = 'page'
        state.originalMounts = {}
      }

      const upsertMount = (moduleCode, operationCodes) => {
        if (!moduleCode) return
        const list = state.form.moduleMounts || []
        const idx = list.findIndex((m) => m.moduleCode === moduleCode)
        const item = { moduleCode, operationCodes: [...(operationCodes || [])] }
        if (idx >= 0) list[idx] = item
        else list.push(item)
        state.form.moduleMounts = [...list]
      }

      const addModuleMount = (fillBasic = false) => {
        const code = state.mountPickCode
        if (!code) {
          $baseMessage('请先选择要挂载的接口模块', 'warning')
          return
        }
        const mod = state.modules.find((m) => m.code === code)
        if (!mod) {
          $baseMessage('模块不存在或未加载', 'warning')
          return
        }
        upsertMount(code, Object.keys(mod.operations || {}))
        if (fillBasic) {
          if (!state.form.menuName) state.form.menuName = mod.name
          if (!state.form.name) {
            state.form.name = mod.code
            state.nameTouched = true
          }
        }
        state.mountPickCode = ''
      }

      const removeModuleMount = (moduleCode) => {
        state.form.moduleMounts = (state.form.moduleMounts || []).filter(
          (m) => m.moduleCode !== moduleCode,
        )
      }

      const getModuleOpsMap = (moduleCode) => {
        const mod = state.modules.find((m) => m.code === moduleCode)
        return mod?.operations || {}
      }

      const getModuleName = (moduleCode) => {
        const mod = state.modules.find((m) => m.code === moduleCode)
        return mod?.name || moduleCode
      }

      const toggleMountAll = (moduleCode, checked) => {
        const ops = getModuleOpsMap(moduleCode)
        upsertMount(moduleCode, checked ? Object.keys(ops) : [])
      }

      const wasModuleMounted = (moduleCode) =>
        Object.prototype.hasOwnProperty.call(state.originalMounts, moduleCode)

      /** Controller 里有、上次保存时还没挂到本菜单的操作码 */
      const getNewOpCodes = (moduleCode) => {
        if (!wasModuleMounted(moduleCode)) return []
        const saved = new Set(state.originalMounts[moduleCode] || [])
        return Object.keys(getModuleOpsMap(moduleCode))
          .map(String)
          .filter((code) => !saved.has(code))
      }

      const isNewOp = (moduleCode, code) => getNewOpCodes(moduleCode).includes(String(code))

      /** 代码里新增、当前表单也还没勾上的 */
      const getPendingNewOpCodes = (moduleCode) => {
        const current = new Set(
          (
            (state.form.moduleMounts || []).find((m) => m.moduleCode === moduleCode)
              ?.operationCodes || []
          ).map(String),
        )
        return getNewOpCodes(moduleCode).filter((code) => !current.has(code))
      }

      const mountNewOps = (moduleCode) => {
        const extra = getPendingNewOpCodes(moduleCode)
        if (!extra.length) return
        const current =
          (state.form.moduleMounts || []).find((m) => m.moduleCode === moduleCode)
            ?.operationCodes || []
        upsertMount(moduleCode, [...new Set([...current.map(String), ...extra])])
      }

      const moduleOptionLabel = (item) => {
        const n = getPendingNewOpCodes(item.code).length
        if (n > 0) return `${item.name} · ${n} 个未挂载`
        return `${item.name} (${item.code})`
      }

      /** 下拉选中模块后的对照预览 */
      const pickPreview = computed(() => {
        const code = state.mountPickCode
        if (!code) return null
        const mod = state.modules.find((m) => m.code === code)
        if (!mod) return null
        const all = Object.entries(mod.operations || {}).map(([key, op]) => ({
          code: String(key),
          name: op?.name || key,
        }))
        const mounted = wasModuleMounted(code)
        return {
          name: mod.name,
          code,
          mounted,
          total: all.length,
          savedCount: mounted ? (state.originalMounts[code] || []).length : 0,
          newOps: mounted
            ? all.filter((op) => getPendingNewOpCodes(code).includes(op.code))
            : all,
        }
      })

      const save = () => {
        refreshFieldRules()
        state.formRef.validate(async (valid) => {
          if (!valid) return
          applyKind(state.form, state.uiType)
          if (!Array.isArray(state.form.moduleMounts)) {
            state.form.moduleMounts = []
          }
          // 不再提交旧 admin-plus 字段，避免覆盖成脏数据
          const payload = { ...state.form }
          delete payload.operations
          delete payload.parentName
          delete payload.boundModuleCodes
          delete payload.children
          state.saving = true
          try {
            const { msg } = await doEdit(payload)
            $baseMessage(msg, 'success')
            emit('fetchData')
            close()
          } finally {
            state.saving = false
          }
        })
      }

      return {
        ...toRefs(state),
        KIND_OPTIONS,
        InfoFilled,
        activeValue,
        showEdit,
        close,
        save,
        setUiType,
        onPathInput,
        refreshFieldRules,
        addModuleMount,
        removeModuleMount,
        getModuleOpsMap,
        getModuleName,
        toggleMountAll,
        getNewOpCodes,
        getPendingNewOpCodes,
        isNewOp,
        mountNewOps,
        moduleOptionLabel,
        pickPreview,
      }
    },
  })
</script>

<template>
  <el-drawer
    v-model="visible"
    append-to-body
    destroy-on-close
    size="760px"
    :title="title"
    @close="close"
  >
    <el-form
      ref="formRef"
      class="menu-edit-form"
      label-width="108px"
      :model="form"
      :rules="rules"
    >
      <div class="kind-grid">
        <button
          v-for="item in KIND_OPTIONS"
          :key="item.key"
          class="kind-card"
          :class="{ active: uiType === item.key }"
          type="button"
          @click="setUiType(item.key)"
        >
          <strong>{{ item.label }}</strong>
          <span>{{ item.desc }}</span>
        </button>
        <button
          v-if="uiType === 'button'"
          class="kind-card active"
          type="button"
        >
          <strong>{{ $tr('按钮') }}</strong>
          <span>{{ $tr('旧数据兼容，不进侧栏路由') }}</span>
        </button>
      </div>

      <el-form-item :label="$tr('上级菜单')" prop="parentId">
        <el-tree-select
          :key="treeSelectKey"
          v-model="form.parentId"
          check-strictly
          :data="treeData"
          default-expand-all
          filterable
          highlight-current
          node-key="menuId"
          :props="defaultProps"
          :render-after-expand="false"
          style="width: 100%"
        />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$tr('菜单名称')" prop="menuName">
            <el-input v-model="form.menuName" maxlength="50" :placeholder="$tr('侧栏 / 面包屑标题')" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('路由 name')" prop="name">
            <el-input
              v-model="form.name"
              maxlength="40"
              :placeholder="$tr('Vue Router name，同级唯一')"
              @input="nameTouched = true"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="path" prop="path">
        <el-input
          v-model="form.path"
          :placeholder="
            uiType === 'link'
              ? 'https://example.com'
              : Number(form.parentId) === 0
                ? '顶级如 /setting，子级填相对段如 menuManagement'
                : '相对父级的路径段，如 menuManagement'
          "
          @blur="onPathInput"
        />
      </el-form-item>

      <el-form-item v-if="uiType === 'page'" :label="$tr('组件路径')" prop="component">
        <template #label>
          <span class="label-with-tip">
            {{ $tr('组件路径') }}
            <el-tooltip
              :content="$tr('相对 src/views，例如 /visual/client/index。隐藏页可不填。')"
              placement="top"
            >
              <el-icon><InfoFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-input v-model="form.component" placeholder="/visual/client/index" />
      </el-form-item>

      <el-form-item v-if="uiType === 'iframe'" :label="$tr('内嵌地址')" prop="iframeSrc">
        <el-input v-model="form.iframeSrc" placeholder="https://..." />
      </el-form-item>

      <el-form-item v-if="uiType === 'catalog'" :label="$tr('重定向')">
        <el-input v-model="form.redirect" :placeholder="$tr('进入目录时跳转，如 /setting/menuManagement')" />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$tr('图标')">
            <IconSelector v-model="form.icon" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('排序')">
            <el-input-number v-model="form.orderNum" :max="9999" :min="0" style="width: 100%" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item :label="$tr('常用开关')">
        <div class="switch-list">
          <label>
            <span>{{ $tr('侧栏显示') }}</span>
            <el-switch
              v-model="form.visible"
              :active-value="activeValue.active"
              :inactive-value="activeValue.inActive"
              @change="refreshFieldRules"
            />
          </label>
          <label v-if="uiType === 'page'">
            <span>{{ $tr('页面缓存') }}</span>
            <el-switch
              v-model="form.isCache"
              :active-value="activeValue.active"
              :inactive-value="activeValue.inActive"
            />
          </label>
          <label v-if="uiType === 'link' || uiType === 'iframe'">
            <span>{{ $tr('新窗口打开') }}</span>
            <el-switch
              v-model="form.openInNewWindow"
              :active-value="activeValue.active"
              :inactive-value="activeValue.inActive"
            />
          </label>
          <label v-if="uiType === 'catalog'">
            <span>{{ $tr('隐藏子菜单') }}</span>
            <el-switch
              v-model="form.hideChildrenInMenu"
              :active-value="activeValue.active"
              :inactive-value="activeValue.inActive"
            />
          </label>
        </div>
      </el-form-item>

      <el-collapse class="advanced-collapse">
        <el-collapse-item name="advanced" :title="$tr('高级（徽标 / 高亮 / Tab）')">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item :label="$tr('高亮 path')">
                <el-input v-model="form.activePath" :placeholder="$tr('隐藏页高亮的父菜单 path')" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$tr('激活图标')">
                <el-input v-model="form.activeIcon" :placeholder="$tr('meta.activeIcon，可空')" />
              </el-form-item>
            </el-col>
            <el-col v-if="uiType === 'page'" :span="12">
              <el-form-item :label="$tr('路由参数')">
                <el-input
                  v-model="form.queryParam"
                  :placeholder='$tr(`JSON，如 {"id":1}`)'
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$tr('徽标')">
                <el-input v-model="form.badge" :placeholder="$tr('如 New')" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$tr('徽标类型')">
                <el-select v-model="form.badgeType" clearable :placeholder="$tr('类型')" style="width: 100%">
                  <el-option :label="$tr('文字')" value="normal" />
                  <el-option :label="$tr('圆点')" value="dot" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$tr('徽标颜色')">
                <el-select v-model="form.badgeVariants" clearable :placeholder="$tr('颜色')" style="width: 100%">
                  <el-option label="primary" value="primary" />
                  <el-option label="success" value="success" />
                  <el-option label="warning" value="warning" />
                  <el-option label="destructive" value="destructive" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <div class="switch-list">
            <label>
              <span>{{ $tr('固定 Tab') }}</span>
              <el-switch
                v-model="form.affixTab"
                :active-value="activeValue.active"
                :inactive-value="activeValue.inActive"
              />
            </label>
            <label>
              <span>{{ $tr('隐藏 Tab') }}</span>
              <el-switch
                v-model="form.hideInTab"
                :active-value="activeValue.active"
                :inactive-value="activeValue.inActive"
              />
            </label>
            <label>
              <span>{{ $tr('隐藏面包屑') }}</span>
              <el-switch
                v-model="form.hideInBreadcrumb"
                :active-value="activeValue.active"
                :inactive-value="activeValue.inActive"
              />
            </label>
          </div>
        </el-collapse-item>
      </el-collapse>

      <div v-if="uiType === 'page' || uiType === 'catalog'" class="mount-card">
        <div class="mount-card__title">
          {{ $tr('接口权限') }}
          <el-tooltip
            :content="$tr('Controller 新增 @Operation 后，这里会标出未挂载项。勾选并保存后才写入。角色若要立刻拥有新权限，需到角色管理里再勾一次该菜单。')"
            placement="top"
          >
            <el-icon><InfoFilled /></el-icon>
          </el-tooltip>
        </div>
        <div class="mount-toolbar">
          <el-select
            v-model="mountPickCode"
            clearable
            filterable
            :placeholder="$tr('选择后端模块，可对照新增接口')"
            style="flex: 1"
          >
            <el-option
              v-for="item in modules"
              :key="item.code"
              :label="moduleOptionLabel(item)"
              :value="item.code"
            >
              <span>{{ item.name }}</span>
              <span class="op-code">{{ item.code }}</span>
              <el-tag
                v-if="getPendingNewOpCodes(item.code).length"
                class="option-tag"
                size="small"
                type="warning"
              >
                {{ getPendingNewOpCodes(item.code).length }} {{ $tr('个未挂载') }}
              </el-tag>
            </el-option>
          </el-select>
          <el-button type="primary" @click="addModuleMount(false)">{{ $tr('挂载') }}</el-button>
          <el-button @click="addModuleMount(true)">{{ $tr('挂载并填名称') }}</el-button>
        </div>

        <div v-if="pickPreview" class="mount-preview">
          <template v-if="pickPreview.mounted">
            <div class="mount-preview__title">
              {{ pickPreview.name }} {{ $tr('已挂到本菜单 （上次') }} {{ pickPreview.savedCount }} {{ $tr('个 / 代码里') }} {{ pickPreview.total }} {{ $tr('个）') }}
            </div>
            <el-alert
              v-if="pickPreview.newOps.length"
              :closable="false"
              show-icon
              type="warning"
              :title="`有 ${pickPreview.newOps.length} 个新接口未挂载`"
            />
            <el-alert
              v-else
              :closable="false"
              show-icon
              type="success"
              :title="$tr('该模块没有未挂载的新接口')"
            />
            <ul v-if="pickPreview.newOps.length" class="mount-preview__list">
              <li v-for="op in pickPreview.newOps" :key="op.code">
                {{ op.name }}
                <span class="op-code">({{ op.code }})</span>
              </li>
            </ul>
            <el-button
              v-if="pickPreview.newOps.length"
              size="small"
              type="warning"
              @click="mountNewOps(pickPreview.code)"
            >
              {{ $tr('勾选这些新接口') }}
            </el-button>
          </template>
          <template v-else>
            <div class="mount-preview__title">
              {{ pickPreview.name }} {{ $tr('尚未挂到本菜单，共') }} {{ pickPreview.total }} {{ $tr('个接口') }}
            </div>
            <ul class="mount-preview__list">
              <li v-for="op in pickPreview.newOps" :key="op.code">
                {{ op.name }}
                <span class="op-code">({{ op.code }})</span>
              </li>
            </ul>
          </template>
        </div>

        <el-empty
          v-if="!(form.moduleMounts && form.moduleMounts.length)"
          :description="$tr('页面接口权限可选挂，目录一般不需要')"
          :image-size="48"
        />

        <div
          v-for="mount in form.moduleMounts"
          :key="mount.moduleCode"
          class="mount-block"
        >
          <div class="mount-block-head">
            <div>
              <strong>{{ getModuleName(mount.moduleCode) }}</strong>
              <span class="op-code">{{ mount.moduleCode }}</span>
              <el-tag
                v-if="getPendingNewOpCodes(mount.moduleCode).length"
                size="small"
                type="warning"
              >
                {{ getPendingNewOpCodes(mount.moduleCode).length }} {{ $tr('个未挂载') }}
              </el-tag>
            </div>
            <el-space>
              <el-button
                v-if="getPendingNewOpCodes(mount.moduleCode).length"
                link
                type="warning"
                @click="mountNewOps(mount.moduleCode)"
              >
                {{ $tr('勾选新增') }}
              </el-button>
              <el-button link type="primary" @click="toggleMountAll(mount.moduleCode, true)">
                {{ $tr('全选') }}
              </el-button>
              <el-button link @click="toggleMountAll(mount.moduleCode, false)">
                {{ $tr('清空') }}
              </el-button>
              <el-button link type="danger" @click="removeModuleMount(mount.moduleCode)">
                {{ $tr('移除') }}
              </el-button>
            </el-space>
          </div>
          <el-checkbox-group v-model="mount.operationCodes">
            <el-checkbox
              v-for="(op, key) in getModuleOpsMap(mount.moduleCode)"
              :key="String(key)"
              :class="{ 'is-new-op': isNewOp(mount.moduleCode, key) }"
              :label="String(key)"
            >
              {{ op.name }}
              <span class="op-code">({{ key }})</span>
              <el-tag v-if="isNewOp(mount.moduleCode, key)" size="small" type="warning">
                {{ $tr('新') }}
              </el-tag>
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </div>

      <el-form-item :label="$tr('备注')">
        <el-input v-model="form.remark" maxlength="200" :placeholder="$tr('仅后台备注，不影响路由')" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $tr('取消') }}</el-button>
      <el-button :loading="saving" type="primary" @click="save">{{ $tr('保存') }}</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.menu-edit-form {
  padding-right: 8px;
}

.kind-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.kind-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}

.kind-card strong {
  font-size: 14px;
}

.kind-card span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.kind-card.active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.label-with-tip {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.switch-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
}

.switch-list label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.advanced-collapse {
  margin-bottom: 16px;
  border: none;
}

.mount-card {
  padding: 12px;
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.mount-card__title {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
  font-weight: 600;
}

.mount-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.mount-block {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 6px;
}

.mount-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.op-code {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.option-tag {
  margin-left: 8px;
}

.mount-preview {
  padding: 10px 12px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.mount-preview__title {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.mount-preview__list {
  padding-left: 18px;
  margin: 8px 0;
  font-size: 13px;
}

.mount-preview :deep(.el-alert) {
  margin-bottom: 4px;
}

.is-new-op {
  padding: 2px 6px;
  background: var(--el-color-warning-light-9);
  border-radius: 4px;
}
</style>
