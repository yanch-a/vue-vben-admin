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
      sysSelect: 1,
      operations: [],
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
      // vben 扩展（与旧字段共存，保存到同一张 sys_menu）
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
          path: [{ required: true, trigger: 'blur', message: '请输入 path' }],
          component: [
            { required: true, trigger: 'blur', message: '请输入 component' },
          ],
        },
        componentValid: {
          required: true,
          trigger: 'blur',
          message: '请输入 component',
        },
        title: '',
        dialogFormVisible: false,
        options: [],
        modules: [],
        selectMenu: '',
        nameFlag: false,
        custom: false,
        operations: {},
        isEdit: false,
        showOperation: false,
        checkAll: false,
      })

      const getOptions = async () => {
        const { data } = await getModules()
        const list = Array.isArray(data) ? data : []
        list.forEach((item) => {
          item.label = item.name
          item.value = item.code
          if (state.form.name === item.code) {
            state.operations = item.operations || {}
            state.showOperation = true
            operationChange()
          }
        })
        state.modules = list
        state.options = list
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
        if (val === 'M') {
          state.form.sysSelect = 0
          state.rules.component = []
        } else {
          state.form.sysSelect = 1
          state.rules.component = [state.componentValid]
        }
        sysSelectChange(state.form.sysSelect)
      }

      const menuChange = (val) => {
        state.form.name = val.code
        state.form.menuName = val.name
        setPath(val.code)
        state.nameFlag = true
        state.form.operations = []
        state.operations = val.operations || {}
        state.showOperation = true
        state.selectMenu = val.code
        operationChange()
      }

      const checkAllHandler = (val) => {
        if (val) {
          state.form.operations = Object.keys(state.operations)
        } else {
          state.form.operations = []
        }
      }

      const operationChange = () => {
        const total = Object.keys(state.operations).length
        state.checkAll =
          total > 0 && total === (state.form.operations || []).length
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
        state.dialogFormVisible = true
      }

      const close = () => {
        state.formRef?.resetFields?.()
        state.form = createDefaultForm()
        state.dialogFormVisible = false
        state.isEdit = false
        state.checkAll = false
        state.nameFlag = false
        state.custom = false
        state.selectMenu = ''
        state.options = []
        state.operations = {}
        state.showOperation = false
      }

      const save = () => {
        state.formRef.validate(async (valid) => {
          if (!valid) return
          const { msg } = await doEdit(state.form)
          $baseMessage(msg, 'success')
          emit('fetchData')
          close()
        })
      }

      const isFrameChange = (val, flag) => {
        if (Number(val) === activeValue.active || state.form.menuType === 'M') {
          state.rules.component = []
        } else {
          state.rules.component = [state.componentValid]
        }
        if (!flag) {
          state.form.sysSelect = Number(val) === 1 ? 0 : 1
        }
        sysSelectChange(state.form.sysSelect)
      }

      const setPath = (val) => {
        if (val && Number(state.form.isFrame) === activeValue.inActive) {
          state.form.path = val.charAt(0).toLowerCase() + val.slice(1)
        }
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
            <el-input v-model="form.path" placeholder="路由 path" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="vue文件路径" prop="component">
        <template #label>
          <span>
            <el-tooltip placement="top">
              <template #content>
                <div>旧框架：目录填 Layout，页面相对路径自动加 @/views/</div>
                <div>新框架：目录可留空或 Layout；页面如 setting/menuManagement/index</div>
                <div>内嵌/外链：可填 InnerLink 或留空，由 isFrame / iframeSrc 决定</div>
              </template>
              <el-icon style="vertical-align: middle"><InfoFilled /></el-icon>
            </el-tooltip>
            vue文件路径
          </span>
        </template>
        <el-input v-model="form.component" placeholder="setting/xxx/index 或 Layout">
          <template #prepend>@/views/</template>
        </el-input>
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
          <span>菜单操作权限</span>
          <el-checkbox
            v-model="checkAll"
            border
            label="全选"
            style="margin-left: 20px"
            @change="checkAllHandler"
          />
        </template>
        <el-checkbox-group v-if="showOperation" v-model="form.operations">
          <el-checkbox
            v-for="(item, key) in operations"
            :key="String(key)"
            border
            :label="String(key)"
            :value="String(key)"
            @change="operationChange"
          >
            {{ item.name }}
          </el-checkbox>
        </el-checkbox-group>
        <el-empty v-else description="选择系统菜单后可配置操作权限" :image-size="48" />
      </vab-card>
    </el-form>

    <template #footer>
      <el-button @click="close">取 消</el-button>
      <el-button type="primary" @click="save">确 定</el-button>
    </template>
  </el-dialog>
</template>
