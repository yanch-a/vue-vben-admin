<script>
  /**
   * 菜单配置（Vben 适配版）
   * 左侧角色过滤已移除；角色可见菜单请到「角色管理 → 分配权限」
   * @author yanch
   */
  import {
    computed,
    defineAsyncComponent,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'

  import { doDelete, doUpdate, getTree } from '@/api/menuManagement'
  import { activeValue } from '@/utils/convert'
  import {
    ArrowDown,
    ArrowUp,
    FolderAdd,
    Plus,
    Search,
    Sort,
  } from '@element-plus/icons-vue'

  /** 将后端菜单行映射为列表展示类型 */
  function resolveKind(row) {
    if (row.menuType === 'M') return 'catalog'
    if (row.menuType === 'F') return 'button'
    if (Number(row.isFrame) === 1) return 'link'
    if (row.iframeSrc) return 'iframe'
    return 'page'
  }

  const KIND_META = {
    catalog: { label: '目录', type: 'info' },
    page: { label: '页面', type: 'primary' },
    link: { label: '外链', type: 'warning' },
    iframe: { label: '内嵌', type: 'success' },
    button: { label: '按钮', type: 'info' },
  }

  export default defineComponent({
    name: 'MenuManagement',
    components: {
      Edit: defineAsyncComponent(
        () => import('./components/MenuManagementEdit.vue'),
      ),
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        tableRef: null,
        editRef: null,
        rawList: [],
        listLoading: true,
        expand: true,
        keyword: '',
        kindFilter: '',
      })

      /** 按关键字 / 类型过滤树，命中子节点时保留祖先 */
      const displayList = computed(() => {
        const keyword = (state.keyword || '').trim().toLowerCase()
        const kindFilter = state.kindFilter
        const walk = (nodes) => {
          const out = []
          for (const node of nodes || []) {
            const children = walk(node.children || [])
            const kind = resolveKind(node)
            const textHit =
              !keyword ||
              [node.menuName, node.name, node.path, node.component].some((v) =>
                String(v || '')
                  .toLowerCase()
                  .includes(keyword),
              )
            const kindHit = !kindFilter || kind === kindFilter
            if ((textHit && kindHit) || children.length) {
              out.push({ ...node, children })
            }
          }
          return out
        }
        return walk(state.rawList)
      })

      const fetchData = async () => {
        state.listLoading = true
        try {
          const res = await getTree({ _t: Date.now() })
          const list = res?.data?.list ?? res?.list ?? []
          state.rawList = Array.isArray(list) ? list : []
        } finally {
          state.listLoading = false
        }
      }

      const handleAdd = () => {
        state.editRef.showEdit()
      }

      const handleAddChild = (row) => {
        state.editRef.showEdit({ parentId: row.menuId })
      }

      const handleEdit = (row) => {
        if (!row?.menuId) return
        state.editRef.showEdit(row)
      }

      const handleDelete = (row) => {
        if (!row?.menuId) return
        if (row.children?.length) {
          $baseMessage('请先删除子菜单', 'warning')
          return
        }
        $baseConfirm('确定删除该菜单？删除后角色授权中的对应项也会失效', null, async () => {
          const { msg } = await doDelete({ id: row.menuId })
          $baseMessage(msg, 'success', 'vab-hey-message-success')
          await fetchData()
        })
      }

      const patchVisible = (nodes, id, visible) => {
        for (const n of nodes || []) {
          if (n.menuId === id) {
            n.visible = visible
            return true
          }
          if (patchVisible(n.children, id, visible)) return true
        }
        return false
      }

      const updateVisible = async (row) => {
        if (state.listLoading || !row.menuId) return
        const next = row.visible
        const prev =
          next === activeValue.active
            ? activeValue.inActive
            : activeValue.active
        try {
          const { msg } = await doUpdate({
            menuId: row.menuId,
            visible: next,
          })
          patchVisible(state.rawList, row.menuId, next)
          $baseMessage(msg, 'success', 'vab-hey-message-success')
        } catch {
          row.visible = prev
          patchVisible(state.rawList, row.menuId, prev)
        }
      }

      /** 在同级内上移 / 下移，并重写 orderNum */
      const moveRow = async (row, dir) => {
        const siblings = findSiblings(state.rawList, row.parentId)
        const idx = siblings.findIndex((s) => s.menuId === row.menuId)
        const targetIdx = idx + dir
        if (idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) return
        const next = siblings.slice()
        const [moved] = next.splice(idx, 1)
        next.splice(targetIdx, 0, moved)
        await Promise.all(
          next.map((item, i) =>
            doUpdate({ menuId: item.menuId, orderNum: (i + 1) * 10 }),
          ),
        )
        $baseMessage('排序已更新', 'success', 'vab-hey-message-success')
        await fetchData()
      }

      const canMove = (row, dir) => {
        const siblings = findSiblings(state.rawList, row.parentId)
        const idx = siblings.findIndex((s) => s.menuId === row.menuId)
        if (idx < 0) return false
        return dir < 0 ? idx > 0 : idx < siblings.length - 1
      }

      const findSiblings = (nodes, parentId) => {
        const pid = Number(parentId || 0)
        if (pid === 0) return nodes || []
        const stack = [...(nodes || [])]
        while (stack.length) {
          const cur = stack.shift()
          if (Number(cur.menuId) === pid) return cur.children || []
          if (cur.children?.length) stack.push(...cur.children)
        }
        return []
      }

      const handleExpand = () => {
        state.expand = !state.expand
        toggleExpand(state.rawList, state.expand)
      }

      const toggleExpand = (data, flag) => {
        ;(data || []).forEach((row) => {
          if (row.children?.length) {
            toggleExpand(row.children, flag)
            state.tableRef?.toggleRowExpansion(row, flag)
          }
        })
      }

      const kindLabel = (row) => KIND_META[resolveKind(row)]?.label || '页面'
      const kindTag = (row) => KIND_META[resolveKind(row)]?.type || 'primary'

      onMounted(() => {
        fetchData()
      })

      return {
        ...toRefs(state),
        displayList,
        handleAdd,
        handleAddChild,
        handleEdit,
        handleDelete,
        handleExpand,
        updateVisible,
        moveRow,
        canMove,
        kindLabel,
        kindTag,
        fetchData,
        activeValue,
        Plus,
        Search,
        Sort,
        FolderAdd,
        ArrowUp,
        ArrowDown,
      }
    },
  })
</script>

<template>
  <div class="menu-management-container">
    <vab-query-form>
      <vab-query-form-left-panel :span="10">
        <el-button
          v-permissions="{ permission: ['MenuManagement:aou'] }"
          :icon="Plus"
          type="primary"
          @click="handleAdd"
        >
          新增菜单
        </el-button>
        <el-button :icon="Sort" @click="handleExpand">
          {{ expand ? '折叠全部' : '展开全部' }}
        </el-button>
      </vab-query-form-left-panel>
      <vab-query-form-right-panel :span="14">
        <el-form inline @submit.prevent>
          <el-form-item>
            <el-select
              v-model="kindFilter"
              clearable
              placeholder="全部类型"
              style="width: 120px"
            >
              <el-option label="目录" value="catalog" />
              <el-option label="页面" value="page" />
              <el-option label="外链" value="link" />
              <el-option label="内嵌" value="iframe" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-input
              v-model.trim="keyword"
              clearable
              :prefix-icon="Search"
              placeholder="搜索名称 / path / 组件"
              style="width: 240px"
            />
          </el-form-item>
        </el-form>
      </vab-query-form-right-panel>
    </vab-query-form>

    <el-table
      ref="tableRef"
      v-loading="listLoading"
      border
      :data="displayList"
      :default-expand-all="expand"
      row-key="menuId"
      :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
    >
      <el-table-column label="菜单" min-width="220">
        <template #default="{ row }">
          <span class="menu-name-cell">
            <vab-icon v-if="row.icon" :icon="row.icon" class="menu-icon" />
            <span>{{ row.menuName || '-' }}</span>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="80">
        <template #default="{ row }">
          <el-tag disable-transitions size="small" :type="kindTag(row)">
            {{ kindLabel(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="路由 name" min-width="140" prop="name" show-overflow-tooltip />
      <el-table-column label="path" min-width="160" prop="path" show-overflow-tooltip />
      <el-table-column label="组件" min-width="180" prop="component" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.iframeSrc" class="muted">iframe</span>
          <span v-else-if="Number(row.isFrame) === 1" class="muted">外链</span>
          <span v-else>{{ row.component || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column align="center" label="排序" width="110">
        <template #default="{ row }">
          <div class="order-cell">
            <span>{{ row.orderNum ?? '-' }}</span>
            <el-button
              :disabled="!canMove(row, -1)"
              :icon="ArrowUp"
              link
              type="primary"
              @click="moveRow(row, -1)"
            />
            <el-button
              :disabled="!canMove(row, 1)"
              :icon="ArrowDown"
              link
              type="primary"
              @click="moveRow(row, 1)"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column align="center" label="侧栏显示" width="90">
        <template #default="{ row }">
          <el-switch
            v-model="row.visible"
            :active-value="activeValue.active"
            :inactive-value="activeValue.inActive"
            @change="updateVisible(row)"
          />
        </template>
      </el-table-column>
      <el-table-column align="right" fixed="right" label="操作" width="220">
        <template #default="{ row }">
          <el-button
            v-permissions="{ permission: ['MenuManagement:aou'] }"
            :icon="FolderAdd"
            link
            type="primary"
            @click="handleAddChild(row)"
          >
            子级
          </el-button>
          <el-button
            v-permissions="{ permission: ['MenuManagement:aou'] }"
            link
            type="primary"
            @click="handleEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permissions="{ permission: ['MenuManagement:delete'] }"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无菜单" />
      </template>
    </el-table>

    <Edit ref="editRef" @fetch-data="fetchData" />
  </div>
</template>

<style lang="scss" scoped>
  .menu-management-container {
    padding: 16px;
    background: var(--el-bg-color);
  }

  .menu-name-cell {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  .menu-icon {
    font-size: 16px;
    color: var(--el-text-color-regular);
  }

  .order-cell {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    justify-content: center;
  }

  .muted {
    color: var(--el-text-color-secondary);
  }
</style>
