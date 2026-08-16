<script>
  /**
   * 角色菜单/接口权限分配
   * - 点击菜单名称：仅展示右侧按钮，不改授权
   * - 点击复选框：授予/撤销该节点及其全部子孙菜单，并自动全开/清空对应按钮权限
   * - 右侧单个按钮：可单独勾选/取消（需菜单已勾选）
   * @author yanch
   */
  import { defineComponent, inject, nextTick, reactive, toRefs } from 'vue'

  import { getTree } from '@/api/menuManagement'
  import {
    getModuleIds,
    getModuleOperations,
    updateRoleOpera,
    updateRolePermBatch,
  } from '@/api/roleManagement'

  export default defineComponent({
    name: 'RoleManagementEditPermissions',
    emits: ['fetchData'],
    setup() {
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        formRef1: null,
        treeRef: null,
        defaultProps: {
          children: 'children',
          label: 'menuName',
        },
        form: {
          roleId: 0,
          btnRolesCheckedList: [],
        },
        rules: {
          role: [{ required: true, trigger: 'blur', message: '请输入角色码' }],
        },
        title: '',
        dialogFormVisible: false,
        list: [],
        btnRoles: [],
        btnRoleGroups: [],
        /** 当前选中的菜单是否已勾选（未勾选则右侧按钮禁用） */
        menuChecked: false,
        checkedKeys: [],
        fetchDataFlag: true,
        currentMenuId: null,
        /** 防止初始化 default-checked 触发授权请求 */
        treeReady: false,
        /** 批量保存中，避免连点 */
        saving: false,
      })

      const showEditPermissions = (row) => {
        if (row) {
          state.form.roleId = row.id
          state.title = '分配权限-【' + row.roleName + '】'
          state.dialogFormVisible = true
          state.treeReady = false
          fetchData()
        }
      }

      const close = () => {
        state.fetchDataFlag = true
        state.treeReady = false
        state.saving = false
        state.formRef1?.resetFields?.()
        state.list = []
        state.form = {
          roleId: 0,
          btnRolesCheckedList: [],
        }
        state.checkedKeys = []
        state.btnRoles = []
        state.btnRoleGroups = []
        state.currentMenuId = null
        state.menuChecked = false
        state.dialogFormVisible = false
      }

      const fetchData = async () => {
        state.fetchDataFlag = true
        state.treeReady = false
        const {
          data: { list },
        } = await getTree()
        const { data } = await getModuleIds({ roleId: state.form.roleId })
        state.checkedKeys = []
        setCheckKeys(list, data || [])
        state.list = list
        state.fetchDataFlag = false
        await nextTick()
        state.treeReady = true
      }

      const setCheckKeys = (list, data) => {
        const idSet = new Set((data || []).map((id) => Number(id)))
        list.forEach((item) => {
          const children = item.children
          if (idSet.has(Number(item.menuId))) {
            state.checkedKeys.push(item.menuId)
          }
          if (children && children.length > 0) {
            setCheckKeys(children, data)
          }
        })
      }

      const groupOperations = (list) => {
        const map = new Map()
        ;(list || []).forEach((op) => {
          const key = op.moduleCode || '未分组'
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(op)
        })
        return [...map.entries()].map(([moduleCode, items]) => ({
          moduleCode,
          items,
        }))
      }

      const normalizeIdList = (ids) =>
        (ids || []).map((id) => Number(id)).filter((n) => !Number.isNaN(n))

      /**
       * 收集节点自身 + 全部子孙中可授权的菜单（M 目录 / C 页面）
       */
      const collectGrantableMenus = (node) => {
        const result = []
        const walk = (n) => {
          if (!n) return
          if (n.menuType === 'C' || n.menuType === 'M') {
            result.push(n)
          }
          ;(n.children || []).forEach(walk)
        }
        walk(node)
        return result
      }

      const loadMenuOperations = async (menuId) => {
        if (!menuId) {
          state.btnRoles = []
          state.btnRoleGroups = []
          state.form.btnRolesCheckedList = []
          return
        }
        const {
          data: { list, operationIds },
        } = await getModuleOperations({
          menuId,
          roleId: state.form.roleId,
        })
        state.btnRoles = list || []
        state.btnRoleGroups = groupOperations(state.btnRoles)
        state.form.btnRolesCheckedList = normalizeIdList(operationIds)
      }

      const isMenuChecked = (menuId) => {
        const keys =
          state.treeRef?.getCheckedKeys?.(false) || state.checkedKeys || []
        return keys.map(Number).includes(Number(menuId))
      }

      /**
       * 同步树勾选状态（级联勾选/取消子孙）
       */
      const syncTreeCheckedKeys = (menuIds, checked) => {
        const idSet = new Set(
          (state.treeRef?.getCheckedKeys?.(false) || []).map(Number),
        )
        menuIds.forEach((id) => {
          const n = Number(id)
          if (checked) {
            idSet.add(n)
          } else {
            idSet.delete(n)
          }
        })
        const nextKeys = [...idSet]
        state.checkedKeys = nextKeys
        state.treeRef?.setCheckedKeys?.(nextKeys)
      }

      /**
       * 点击菜单名称：只加载右侧按钮列表，绝不改勾选状态
       */
      const onNodeLabelClick = async (nodeData) => {
        if (!nodeData || state.saving) return
        state.currentMenuId = nodeData.menuId
        state.menuChecked = isMenuChecked(nodeData.menuId)
        state.treeRef?.setCurrentKey?.(nodeData.menuId)
        await loadMenuOperations(nodeData.menuId)
      }

      /**
       * 点击复选框：级联自身+子孙菜单，并批量写入菜单与全部按钮权限
       */
      const onTreeCheck = async (node) => {
        if (!state.treeReady || state.fetchDataFlag || state.saving) return
        if (!node || (node.menuType !== 'C' && node.menuType !== 'M')) return

        // 以树当前状态判断：刚点完复选框后，该节点是否在已勾选集合中
        const checkedNow = isMenuChecked(node.menuId)
        const dealType = checkedNow ? 1 : 0
        const targets = collectGrantableMenus(node)
        const menuIds = targets.map((t) => t.menuId).filter((id) => id != null)

        if (menuIds.length === 0) return

        state.saving = true
        try {
          // UI 级联：父勾选则子孙全勾；父取消则子孙全消
          syncTreeCheckedKeys(menuIds, checkedNow)

          const { msg } = await updateRolePermBatch({
            roleId: state.form.roleId,
            menuIds,
            dealType,
          })
          $baseMessage(
            msg || (checkedNow ? '已授予菜单及按钮权限' : '已撤销菜单及按钮权限'),
            'success',
            'vab-hey-message-success',
          )

          state.currentMenuId = node.menuId
          state.menuChecked = checkedNow
          state.treeRef?.setCurrentKey?.(node.menuId)
          await loadMenuOperations(node.menuId)
        } catch (e) {
          // 失败回滚树勾选：重新拉角色已授权菜单
          await fetchData()
          $baseMessage(
            e?.msg || e?.message || '保存权限失败',
            'error',
            'vab-hey-message-error',
          )
        } finally {
          state.saving = false
        }
      }

      const isOpChecked = (operaId) => {
        const n = Number(operaId)
        return state.form.btnRolesCheckedList.some((x) => Number(x) === n)
      }

      /**
       * 右侧单个按钮权限：独立增删
       */
      const onOperaToggle = async (operaId, checked) => {
        if (operaId == null || state.saving) return
        if (!state.menuChecked) {
          $baseMessage('请先勾选左侧菜单，再配置按钮权限', 'warning')
          return
        }
        const id = Number(operaId)
        const turnOn = checked === true
        try {
          const { msg } = await updateRoleOpera({
            roleId: state.form.roleId,
            operaId: id,
            dealType: turnOn ? 1 : 0,
          })
          $baseMessage(msg, 'success', 'vab-hey-message-success')
          if (turnOn) {
            if (!state.form.btnRolesCheckedList.some((x) => Number(x) === id)) {
              state.form.btnRolesCheckedList.push(id)
            }
          } else {
            state.form.btnRolesCheckedList =
              state.form.btnRolesCheckedList.filter((x) => Number(x) !== id)
          }
        } catch (e) {
          if (state.currentMenuId) {
            await loadMenuOperations(state.currentMenuId)
          }
        }
      }

      return {
        ...toRefs(state),
        showEditPermissions,
        close,
        fetchData,
        onNodeLabelClick,
        onTreeCheck,
        isOpChecked,
        onOperaToggle,
      }
    },
  })
</script>

<template>
  <el-dialog
    v-model="dialogFormVisible"
    :title="title"
    width="80%"
    @close="close"
  >
    <el-form ref="formRef1" label-width="80px" :model="form" :rules="rules" v-loading="saving">
      <div class="hint">
        点击菜单名称仅查看按钮；勾选复选框会授予该节点及全部子菜单，并自动勾选其全部按钮权限；取消勾选则一并撤销。
      </div>
      <div class="vab-tree-border">
        <div class="tree-pane">
          <el-tree
            ref="treeRef"
            :data="list"
            :default-checked-keys="checkedKeys"
            :default-expanded-keys="checkedKeys"
            node-key="menuId"
            :props="defaultProps"
            show-checkbox
            highlight-current
            :check-on-click-node="false"
            :expand-on-click-node="false"
            check-strictly
            @check="onTreeCheck"
          >
            <template #default="{ node, data }">
              <span
                class="tree-node-label"
                @click.stop.prevent="onNodeLabelClick(data)"
              >
                {{ node.label }}
              </span>
            </template>
          </el-tree>
        </div>
        <div class="ops-pane">
          <div v-if="!currentMenuId" class="ops-empty">
            请点击左侧菜单名称，查看并配置该菜单下的按钮权限。
          </div>
          <div v-else-if="!btnRoleGroups.length" class="ops-empty">
            当前菜单尚未挂载接口权限，请到「菜单管理」中为该菜单挂载模块操作。
          </div>
          <template v-else>
            <div v-if="!menuChecked" class="ops-warn">
              该菜单尚未勾选，右侧按钮不可改。请先勾选左侧复选框。
            </div>
            <div
              v-for="group in btnRoleGroups"
              :key="group.moduleCode"
              class="ops-group"
            >
              <div class="ops-group-title">{{ group.moduleCode }}</div>
              <div class="ops-list">
                <el-checkbox
                  v-for="item in group.items"
                  :key="item.id"
                  border
                  class="op-item"
                  :model-value="isOpChecked(item.id)"
                  :disabled="!menuChecked || saving"
                  @change="(val) => onOperaToggle(item.id, val)"
                >
                  {{ item.operationName }}
                  <span class="op-code">({{ item.operationCode }})</span>
                </el-checkbox>
              </div>
            </div>
          </template>
        </div>
      </div>
    </el-form>
    <template #footer>
      <el-button type="primary" :disabled="saving" @click="close">关 闭</el-button>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
  .hint {
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .vab-tree-border {
    display: flex;
    width: 100%;
    height: 420px;
    padding: 12px;
    overflow: hidden;
    border: 1px solid #dcdfe6;
    border-radius: 2.5px;
  }
  .tree-pane {
    width: 32%;
    overflow: auto;
    border-right: 1px solid #ebeef5;
    padding-right: 8px;
  }
  .tree-node-label {
    display: inline-block;
    flex: 1;
    padding-right: 8px;
    cursor: pointer;
    user-select: none;
  }
  .ops-pane {
    flex: 1;
    overflow: auto;
    padding-left: 12px;
  }
  .ops-empty,
  .ops-warn {
    font-size: 13px;
    padding: 16px 8px;
  }
  .ops-empty {
    color: var(--el-text-color-secondary);
  }
  .ops-warn {
    color: var(--el-color-warning);
    margin-bottom: 8px;
  }
  .ops-group {
    margin-bottom: 14px;
  }
  .ops-group-title {
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--el-text-color-primary);
  }
  .ops-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .op-item {
    margin-right: 0;
  }
  .op-code {
    margin-left: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
</style>
