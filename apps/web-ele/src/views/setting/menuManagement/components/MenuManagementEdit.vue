<script>
  import { defineComponent, inject, reactive, toRefs } from 'vue'

  import { doEdit, getById, getModules, getTree } from '@/api/menuManagement'
  import IconSelector from '@/components/IconSelector/index.vue'
  import { activeValue, getDictData } from '@/utils/convert'
  import { InfoFilled } from '@element-plus/icons-vue'

  function toMenuTypeOptions() {
    const data = getDictData('menuType')?.data || {
      M: '目录',
      C: '菜单',
      F: '按钮',
    }
    return Object.entries(data).map(([value, label]) => ({
      value,
      label,
    }))
  }

  function createDefaultForm() {
    return {
      visible: activeValue.active,
      isCache: activeValue.active,
      isFrame: activeValue.inActive,
      noColumn: activeValue.inActive,
      orderNum: 10,
      menuType: 'C',
      // 默认自定义菜单：页面路由与权限模块解耦，通过「接口权限挂载」绑定
      sysSelect: 0,
      operations: [],
      moduleMounts: [],
      icon: '',
      activeIcon: '',
      parentId: 0,
      parentName: '',
      menuName: '',
      name: '',
      path: '',
      component: '',
      queryParam: '',
      remark: '',
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
    }
  }

  function toFlag(val, fallback = activeValue.inActive) {
    if (val === null || val === undefined || val === '') return fallback
    return Number(val)
  }

  /** 后端常把数字字段序列化成字符串，导致 el-select / switch 对不上 */
  function normalizeMenuForm(data) {
    const form = { ...createDefaultForm(), ...data }
    form.sysSelect = Number(form.sysSelect ?? 1)
    form.parentId =
      form.parentId === null || form.parentId === undefined || form.parentId === ''
        ? 0
        : Number(form.parentId)
    form.orderNum = Number(form.orderNum ?? 10)
    form.visible = toFlag(form.visible, activeValue.active)
    form.isCache = toFlag(form.isCache, activeValue.active)
    form.isFrame = toFlag(form.isFrame, activeValue.inActive)
    form.noColumn = toFlag(form.noColumn, activeValue.inActive)
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
    form.operations = Array.isArray(form.operations)
      ? form.operations.map(String)
      : []
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

  export default defineComponent({
    name: 'MenuManagementEdit',
    components: { IconSelector, InfoFilled },
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
        },
        menuTypeOptions: toMenuTypeOptions(),
        form: createDefaultForm(),
        rules: {
          parentId: [
            { required: true, trigger: 'change', message: '请选择父级菜单' },
          ],
          menuName: [
            { required: true, trigger: 'blur', message: '请输入菜单名称' },
          ],
          name: [{ required: true, trigger: 'blur', message: '请输入 name' }],
          menuType: [
            { required: true, trigger: 'change', message: '请选择菜单类型' },
          ],
          sysSelect: [
            { required: true, trigger: 'change', message: '请选择菜单来源' },
          ],
          path: [],
          component: [],
        },
        componentValid: {
          required: true,
          trigger: 'blur',
          message: '请输入 component',
        },
        pathValid: {
          required: true,
          trigger: 'blur',
          message: '请输入 path',
        },
        title: '',
        dialogFormVisible: false,
        options: [],
        modules: [],
        selectMenu: '',
        nameFlag: false,
        custom: true,
        operations: {},
        isEdit: false,
        showOperation: false,
        checkAll: false,
        /** 待添加的模块码（挂载器） */
        mountPickCode: '',
      })

      /** 按菜单类型 / 可见性刷新 path、component 校验 */
      const refreshFieldRules = () => {
        const type = state.form.menuType
        const visible = Number(state.form.visible)
        if (type === 'M' || type === 'F') {
          state.rules.path = []
          state.rules.component = []
          return
        }
        // 页面 C：可见时 path+component 必填；隐藏权限桩可不填 component
        state.rules.path = [state.pathValid]
        state.rules.component =
          visible === activeValue.active ? [state.componentValid] : []
      }

      const getOptions = async () => {
        const { data } = await getModules()
        const list = Array.isArray(data) ? data : []
        list.forEach((item) => {
          item.label = item.name
          item.value = item.code
        })
        state.modules = list
        state.options = list
        // 旧：单系统模块勾选回显
        if (Number(state.form.sysSelect) === 1 && state.form.name) {
          const hit = list.find((m) => m.code === state.form.name)
          if (hit) {
            state.operations = hit.operations || {}
            state.showOperation = true
            state.selectMenu = hit.code
            operationChange()
          }
        }
      }

      const onSelectMenuChange = (code) => {
        if (!code) return
        const item = state.modules.find((m) => m.code === code || m.value === code)
        if (item) menuChange(item)
      }

      const sysSelectChange = (val) => {
        if (Number(val) === 1) {
          state.nameFlag = true
          state.custom = false
          getOptions()
        } else {
          state.nameFlag = false
          state.custom = true
          state.operations = {}
          state.showOperation = false
          state.selectMenu = ''
        }
      }

      const menuTypeChange = (val) => {
        if (val === 'M' || val === 'F') {
          state.form.sysSelect = 0
        }
        sysSelectChange(state.form.sysSelect)
        refreshFieldRules()
      }

      const menuChange = (val) => {
        // 仅回填模块码与展示名；不覆盖用户已填的 path（避免 DataBaseOperate → dataBaseOperate）
        state.form.name = val.code
        if (!state.form.menuName) {
          state.form.menuName = val.name
        }
        state.nameFlag = true
        state.form.operations = Object.keys(val.operations || {})
        state.operations = val.operations || {}
        state.showOperation = true
        state.selectMenu = val.code
        operationChange()
        // 同步进挂载列表（单模块快捷）
        upsertMount(val.code, state.form.operations)
      }

      const upsertMount = (moduleCode, operationCodes) => {
        if (!moduleCode) return
        const list = state.form.moduleMounts || []
        const idx = list.findIndex((m) => m.moduleCode === moduleCode)
        const item = {
          moduleCode,
          operationCodes: [...(operationCodes || [])],
        }
        if (idx >= 0) {
          list[idx] = item
        } else {
          list.push(item)
        }
        state.form.moduleMounts = [...list]
      }

      const addModuleMount = () => {
        const code = state.mountPickCode
        if (!code) {
          $baseMessage('请先选择要挂载的后端模块', 'warning')
          return
        }
        const mod = state.modules.find((m) => m.code === code)
        if (!mod) {
          $baseMessage('模块不存在或未加载', 'warning')
          return
        }
        const codes = Object.keys(mod.operations || {})
        upsertMount(code, codes)
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

      const toggleMountAll = (moduleCode, checked) => {
        const ops = getModuleOpsMap(moduleCode)
        const codes = checked ? Object.keys(ops) : []
        upsertMount(moduleCode, codes)
      }

      const checkAllHandler = (val) => {
        if (val) {
          state.form.operations = Object.keys(state.operations)
        } else {
          state.form.operations = []
        }
        if (state.form.name) {
          upsertMount(state.form.name, state.form.operations)
        }
      }

      const operationChange = () => {
        const total = Object.keys(state.operations).length
        state.checkAll =
          total > 0 && total === (state.form.operations || []).length
        if (Number(state.form.sysSelect) === 1 && state.form.name) {
          upsertMount(state.form.name, state.form.operations || [])
        }
      }

      const fetchData = async () => {
        const res = await getTree()
        const list = res?.data?.list ?? res?.list ?? res?.data ?? []
        state.treeData = Array.isArray(list) ? list : []
      }

      const handleNodeClick = (node) => {
        state.form.parentName = node.menuName
        state.form.parentId = Number(node.menuId)
      }

      const showEdit = async (row) => {
        await fetchData()
        await getOptions()
        if (!row) {
          state.title = '新增菜单'
          state.form = createDefaultForm()
          state.selectMenu = ''
          state.isEdit = false
        } else {
          state.title = `编辑菜单-【${row.menuName}】`
          const { data } = await getById(row)
          if (!data) {
            $baseMessage('未查到相关数据', 'error')
            return
          }
          state.form = normalizeMenuForm(data)
          isFrameChange(state.form.isFrame, true)
          state.selectMenu = data.name || ''
          state.isEdit = true
        }
        state.showOperation = false
        if (Number(state.form.sysSelect) === 1) {
          await getOptions()
        }
        refreshFieldRules()
        state.dialogFormVisible = true
      }

      const close = () => {
        state.formRef?.resetFields?.()
        state.form = createDefaultForm()
        state.dialogFormVisible = false
        state.isEdit = false
        state.checkAll = false
        state.nameFlag = false
        state.custom = true
        state.selectMenu = ''
        state.options = []
        state.operations = {}
        state.showOperation = false
        state.mountPickCode = ''
      }

      const save = () => {
        refreshFieldRules()
        state.formRef.validate(async (valid) => {
          if (!valid) return
          // 兼容：系统单模块勾选写入 moduleMounts
          if (
            Number(state.form.sysSelect) === 1 &&
            state.form.name &&
            (!state.form.moduleMounts || !state.form.moduleMounts.length)
          ) {
            upsertMount(state.form.name, state.form.operations || [])
          }
          const { msg } = await doEdit(state.form)
          $baseMessage(msg, 'success')
          emit('fetchData')
          close()
        })
      }

      const isFrameChange = (val, flag) => {
        if (!flag && Number(val) === activeValue.active) {
          state.form.sysSelect = 0
        }
        sysSelectChange(state.form.sysSelect)
        refreshFieldRules()
      }

      const setPath = () => {
        // 不再根据 name 自动改写 path，避免模块码污染路由
      }

      const onVisibleChange = () => {
        refreshFieldRules()
      }

      return {
        ...toRefs(state),
        handleNodeClick,
        showEdit,
        close,
        save,
        isFrameChange,
        setPath,
        activeValue,
        InfoFilled,
        menuChange,
        onSelectMenuChange,
        sysSelectChange,
        menuTypeChange,
        checkAllHandler,
        operationChange,
        addModuleMount,
        removeModuleMount,
        getModuleOpsMap,
        toggleMountAll,
        upsertMount,
        onVisibleChange,
      }
    },
  })
</script>

<template>
  <el-dialog
    v-model="dialogFormVisible"
    append-to-body
    destroy-on-close
    :title="title"
    width="1220px"
    @close="close"
  >
    <el-form
      ref="formRef"
      label-width="120px"
      :model="form"
      :rules="rules"
    >
      <el-divider content-position="left">基础信息（新旧共用）</el-divider>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="菜单类型" prop="menuType">
            <el-select
              v-model="form.menuType"
              :disabled="isEdit"
              placeholder="菜单类型"
              style="width: 100%"
              @change="menuTypeChange"
            >
              <el-option
                v-for="item in menuTypeOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="上级菜单" prop="parentId">
            <el-tree-select
              v-model="form.parentId"
              check-strictly
              clearable
              :data="treeData"
              default-expand-all
              highlight-current
              node-key="menuId"
              :props="defaultProps"
              :render-after-expand="false"
              style="width: 100%"
              @node-click="handleNodeClick"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="菜单来源" prop="sysSelect">
            <el-select
              v-model="form.sysSelect"
              :disabled="isEdit"
              style="width: 100%"
              @change="sysSelectChange"
            >
              <el-option label="系统菜单" :value="1" />
              <el-option label="自定义菜单" :value="0" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="选择菜单">
            <el-select
              v-model="selectMenu"
              clearable
              :disabled="custom || isEdit"
              filterable
              placeholder="选择菜单"
              style="width: 100%"
              @change="onSelectMenuChange"
            >
              <el-option
                v-for="item in options"
                :key="item.value"
                :label="`${item.name} (${item.code})`"
                :value="item.value"
              >
                <span>{{ item.name }}</span>
                <span style="float: right; font-size: 12px; color: var(--el-text-color-secondary)">
                  {{ item.code }}
                </span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="菜单名称" prop="menuName">
            <el-input v-model="form.menuName" placeholder="侧栏/面包屑标题" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="router-name" prop="name">
            <el-input
              v-model="form.name"
              :disabled="nameFlag"
              placeholder="路由 name，vben 必填"
              @input="setPath"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="path" prop="path">
            <el-input
              v-model="form.path"
              placeholder="相对段，如 client（拼到父级成 /visual/client）"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="vue文件路径" prop="component">
        <template #label>
          <span>
            <el-tooltip placement="top">
              <template #content>
                <div>目录 M / 按钮 F：可留空</div>
                <div>可见页面 C：填 /visual/client/index（相对 views）</div>
                <div>隐藏权限桩（visible=关）：component 可留空，不进路由</div>
              </template>
              <el-icon style="vertical-align: middle"><InfoFilled /></el-icon>
            </el-tooltip>
            vue文件路径
          </span>
        </template>
        <el-input
          v-model="form.component"
          placeholder="/visual/client/index 或留空"
        />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="6">
          <el-form-item label="路由参数" prop="queryParam">
            <el-input v-model="form.queryParam" placeholder="JSON，如 {&quot;id&quot;:1}" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="排序" prop="orderNum">
            <el-input-number
              v-model="form.orderNum"
              :max="1000"
              :min="0"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="备注">
            <el-input v-model="form.remark" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="图标">
            <IconSelector v-model="form.icon" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="基础开关">
        <el-space wrap>
          <span>外链</span>
          <el-switch
            v-model="form.isFrame"
            :active-value="activeValue.active"
            :disabled="nameFlag"
            :inactive-value="activeValue.inActive"
            @change="isFrameChange"
          />
          <span>缓存</span>
          <el-switch
            v-model="form.isCache"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
          <span>可见</span>
          <el-switch
            v-model="form.visible"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
            @change="onVisibleChange"
          />
          <span>无分栏</span>
          <el-switch
            v-model="form.noColumn"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
        </el-space>
      </el-form-item>

      <el-divider content-position="left">Vben 扩展（新旧接口共用库字段）</el-divider>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="redirect">
            <el-input v-model="form.redirect" placeholder="目录重定向，如 /setting/menu" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="activePath">
            <template #label>
              <span>
                <el-tooltip content="隐藏页高亮的父菜单 path，对应 meta.activePath / 旧 activeMenu" placement="top">
                  <el-icon style="vertical-align: middle"><InfoFilled /></el-icon>
                </el-tooltip>
                activePath
              </span>
            </template>
            <el-input v-model="form.activePath" placeholder="如 /setting/menuManagement" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="激活图标">
            <el-input v-model="form.activeIcon" placeholder="meta.activeIcon，可空" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="iframeSrc">
            <el-input v-model="form.iframeSrc" placeholder="内嵌地址，对应 IFrameView" />
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="徽标">
            <el-input v-model="form.badge" placeholder="badge" />
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="徽标类型">
            <el-select v-model="form.badgeType" clearable placeholder="类型" style="width: 100%">
              <el-option label="normal" value="normal" />
              <el-option label="dot" value="dot" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item label="徽标色">
            <el-select v-model="form.badgeVariants" clearable placeholder="色" style="width: 100%">
              <el-option label="primary" value="primary" />
              <el-option label="success" value="success" />
              <el-option label="warning" value="warning" />
              <el-option label="destructive" value="destructive" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="Vben 开关">
        <el-space wrap>
          <span>固定Tab</span>
          <el-switch
            v-model="form.affixTab"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
          <span>隐藏Tab</span>
          <el-switch
            v-model="form.hideInTab"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
          <span>隐藏面包屑</span>
          <el-switch
            v-model="form.hideInBreadcrumb"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
          <span>隐藏子菜单</span>
          <el-switch
            v-model="form.hideChildrenInMenu"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
          <span>新窗口打开</span>
          <el-switch
            v-model="form.openInNewWindow"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
          />
        </el-space>
      </el-form-item>

      <vab-card shadow="hover">
        <template #header>
          <span>接口权限挂载</span>
          <el-tooltip
            content="从后端 @Module 勾选操作，挂到本菜单。一个页面可挂多个模块（如客户端挂 DataBaseOperate+SavedQuery）。权限码仍是 Module:op"
            placement="top"
          >
            <el-icon style="margin-left: 6px; vertical-align: middle">
              <InfoFilled />
            </el-icon>
          </el-tooltip>
        </template>

        <div class="mount-toolbar">
          <el-select
            v-model="mountPickCode"
            clearable
            filterable
            placeholder="选择后端模块"
            style="width: 320px"
          >
            <el-option
              v-for="item in modules"
              :key="item.code"
              :label="`${item.name} (${item.code})`"
              :value="item.code"
            />
          </el-select>
          <el-button type="primary" style="margin-left: 8px" @click="addModuleMount">
            添加挂载
          </el-button>
        </div>

        <el-empty
          v-if="!(form.moduleMounts && form.moduleMounts.length)"
          description="尚未挂载接口权限，请从上方选择模块添加"
          :image-size="48"
        />

        <div
          v-for="mount in form.moduleMounts"
          :key="mount.moduleCode"
          class="mount-block"
        >
          <div class="mount-block-head">
            <strong>{{ mount.moduleCode }}</strong>
            <el-space>
              <el-button
                link
                type="primary"
                @click="toggleMountAll(mount.moduleCode, true)"
              >
                全选
              </el-button>
              <el-button
                link
                @click="toggleMountAll(mount.moduleCode, false)"
              >
                清空
              </el-button>
              <el-button
                link
                type="danger"
                @click="removeModuleMount(mount.moduleCode)"
              >
                移除
              </el-button>
            </el-space>
          </div>
          <el-checkbox-group v-model="mount.operationCodes">
            <el-checkbox
              v-for="(op, key) in getModuleOpsMap(mount.moduleCode)"
              :key="String(key)"
              border
              :label="String(key)"
            >
              {{ op.name }}
              <span class="op-code">({{ key }})</span>
            </el-checkbox>
          </el-checkbox-group>
        </div>

        <!-- 兼容旧：系统菜单单模块快捷勾选 -->
        <div v-if="showOperation" class="legacy-ops">
          <el-divider content-position="left">系统菜单快捷勾选（同步到上方挂载）</el-divider>
          <el-checkbox
            v-model="checkAll"
            border
            label="全选"
            @change="checkAllHandler"
          />
          <el-checkbox-group v-model="form.operations" style="margin-top: 8px">
            <el-checkbox
              v-for="(item, key) in operations"
              :key="String(key)"
              border
              :label="String(key)"
              @change="operationChange"
            >
              {{ item.name }}
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </vab-card>
    </el-form>

    <template #footer>
      <el-button @click="close">取 消</el-button>
      <el-button type="primary" @click="save">确 定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mount-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}
.mount-block {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.mount-block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.op-code {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.legacy-ops {
  margin-top: 8px;
}
</style>
