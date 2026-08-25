<script>
/**
 * 表分组画布：左侧分组草稿 + 右侧远端表勾选，按 sourceTableId 合并去重后保存
 * @author yanch
 */
import { computed, defineComponent, inject, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getInstances, getTableDDL, getTablesWithColumns, testConnection } from '@/api/visual/database'
import { deleteTableGroup, editTableGroup, getGroupTablesWithColumns, getTableGroupList, saveGroupTables2DB } from '@/api/visual/vq'
import { backToListPage } from '@/utils/route-back'
import { ElMessage, ElMessageBox } from 'element-plus'

export default defineComponent({
  name: 'DbConfigCanvas',
  setup() {
    const $baseMessage = inject('$baseMessage')
    const route = useRoute()
    const router = useRouter()
    const loading = ref(false)
    const dbSearchKeyword = ref('')
    const searchKeyword = ref('')
    const dbTree = ref(null)
    const groupTree = ref(null)
    const tableTreeRef = ref(null)
    const groupFormRef = ref(null)
    // 默认展示分组
    const leftActiveTab = ref('groups')
    const groupContentTab = ref('groupTables')
    
    // 选中的分组
    const selectedGroup = ref(null)
    const groupSelectedTables = ref([])
    const groupSelectedColumns = ref([])
    // 选中的实例
    const selectedInstance = ref(null)

    // 对话框控制
    const groupDialogVisible = ref(false)
    const groupDialogType = ref('add')
    const ddlDialogVisible = ref(false)

    // 数据库树配置
    const dbTreeProps = {
      label: 'instanceName',
      children: 'instances'
    }
    
    // 分组树配置
    const groupTreeProps = {
      label: 'groupName',
      children: 'children'
    }
    
    // 数据库列表数据
    const dbList = ref([])
    
    // 表列表数据
    const tableList = ref([])
    
    // 选中的表和字段
    const selectedTables = ref([])
    const selectedColumns = ref([])
    
    // 转换表和字段数据为树形结构
    const transformedTables = computed(() => {
      const result = []
      const keyword = searchKeyword.value.toLowerCase()
      
      for (const table of tableList.value) {
        // 如果有搜索关键词，进行过滤
        if (keyword && 
            !table.tableName.toLowerCase().includes(keyword) && 
            !table.displayName?.toLowerCase().includes(keyword)) {
          continue
        }
        
        // 构建表节点（带 schema，支持多库合并进分组）
        const tableNode = {
          id: table.id,
          name: table.tableName,
          tableName: table.tableName,
          comment: table.displayName || '',
          isTable: true,
          instanceName: table.schemaName || selectedInstance.value?.instanceName,
          schemaName: table.schemaName || selectedInstance.value?.instanceName,
          children: []
        }
        
        // 添加字段子节点
        if (table.columns) {
          for (const column of table.columns) {
            tableNode.children.push({
              id: column.id,
              name: column.fieldName,
              comment: column.displayName || '',
              isTable: false,
              tableId: table.id,
              columnId: column.id,
              dataType: column.dataType,
              isPrimary: column.isPrimary,
              isNullable: column.isNullable
            })
          }
        }
        
        result.push(tableNode)
      }
      
      return result
    })
    
    // 是否有选中的项
    const hasSelectedItems = computed(() => {
      return selectedGroup.value != null;
    })
    
    // 判断是否有选中可添加的表或字段
    const hasSelectedItemsToAdd = computed(() => {
      return selectedTables.value.length > 0 || selectedColumns.value.length > 0
    })

    /** 恢复右侧勾选时忽略 check-change，避免把已有表再推进 selectedTables */
    const syncingTreeCheck = ref(false)
    
    // 过滤数据库列表
    const filteredDbList = computed(() => {
      if (!dbSearchKeyword.value) return dbList.value
      
      const keyword = dbSearchKeyword.value.toLowerCase()
      // 深拷贝并过滤数据
      return dbList.value.map(instance => {
        // 如果实例名称匹配关键词，保留整个实例
        if (instance.instanceName.toLowerCase().includes(keyword)) {
          return JSON.parse(JSON.stringify(instance))
        }
        
        // 否则，只保留匹配的表
        const filteredTables = (instance.tables || []).filter(table => 
          table.tableName.toLowerCase().includes(keyword)
        )
        
        // 如果有匹配的表，返回包含匹配表的实例
        if (filteredTables.length > 0) {
          return {
            ...instance,
            tables: filteredTables
          }
        }
        
        // 如果没有匹配的表，不返回此实例
        return null
      }).filter(Boolean) // 删除空值
    })
    
    // 分组列表数据
    const groupList = ref([])
    
    // 分组表单数据
    const groupForm = reactive({
      id: undefined,
      groupName: '',
      schemaName: '',
      description: '',
      orderNum: 0,
      isPublic: 1,
    })
    
    // 分组表单校验规则（默认浏览库可选，分组可跨多实例）
    const groupRules = {
      groupName: [{ required: true, message: '请输入分组名称', trigger: 'blur' }],
    }

    // 可选数据库实例列表
    const instanceOptions = computed(() => {
      const root = dbList.value?.[0]
      return root?.instances || []
    })

    /** 远端表 id 与目录 sourceTableId 均为 schema-dbConfigId-tableName */
    const resolveTableName = (table) => table?.tableName || table?.name || ''

    const resolveSourceTableId = (table) => {
      if (table?.sourceTableId) {
        return String(table.sourceTableId)
      }
      if (table?.id != null && String(table.id).includes('-')) {
        return String(table.id)
      }
      const name = resolveTableName(table)
      const schema = table?.schemaName || table?.instanceName || selectedGroup.value?.schemaName || ''
      if (!name) {
        return table?.id != null ? String(table.id) : ''
      }
      return `${schema}-${route.query.id}-${name}`
    }

    const groupTableKey = (table) => resolveSourceTableId(table) || `name:${resolveTableName(table)}`

    /**
     * 统一成左侧「当前组的表」结构，避免 tableName / name、id / sourceTableId 混用导致重复行
     */
    const toGroupTableRow = (table) => {
      const sourceTableId = resolveSourceTableId(table)
      const schema = table.schemaName || table.instanceName || selectedGroup.value?.schemaName
      const tableIdForCols = table.sourceTableId || table.id
      const rawCols = (table.columns && table.columns.length)
        ? table.columns
        : selectedColumns.value.filter(
            (c) => String(c.tableId) === String(tableIdForCols) || String(c.tableId) === String(table.id),
          )
      return {
        sourceTableId,
        dbConfigId: route.query.id,
        tableName: resolveTableName(table),
        schemaName: schema,
        displayName: table.displayName || table.comment || '',
        alias: table.alias,
        orderNum: table.orderNum || 0,
        columns: (rawCols || []).map((column, idx) => ({
          sourceFieldId: column.sourceFieldId || column.id,
          sourceTableId,
          fieldName: column.fieldName || column.columnName,
          displayName: column.displayName || '',
          dataType: column.dataType,
          isPrimary: column.isPrimary,
          isNullable: column.isNullable,
          orderNum: column.orderNum != null ? column.orderNum : idx,
        })),
      }
    }

    const mergeGroupTables = (existing, incoming) => {
      const map = new Map()
      for (const t of existing || []) {
        map.set(groupTableKey(t), toGroupTableRow(t))
      }
      for (const t of incoming || []) {
        const row = toGroupTableRow(t)
        const key = groupTableKey(row)
        const old = map.get(key)
        if (old) {
          const colMap = new Map()
          for (const c of old.columns || []) {
            colMap.set(String(c.sourceFieldId), c)
          }
          for (const c of row.columns || []) {
            colMap.set(String(c.sourceFieldId || c.id), c)
          }
          row.columns = [...colMap.values()]
          row.tableName = row.tableName || old.tableName
          row.displayName = row.displayName || old.displayName
          row.alias = old.alias || row.alias
        }
        map.set(key, row)
      }
      return [...map.values()].map((t, i) => ({ ...t, orderNum: i }))
    }

    const applyGroupTablesToRightTree = () => {
      if (!tableTreeRef.value) {
        return
      }
      syncingTreeCheck.value = true
      try {
        tableTreeRef.value.setCheckedKeys([], false)
        for (const table of groupSelectedTables.value) {
          const tid = table.sourceTableId
          if (tid != null) {
            tableTreeRef.value.setChecked(tid, true, false)
          }
          for (const col of table.columns || []) {
            const cid = col.sourceFieldId || col.id
            if (cid != null) {
              tableTreeRef.value.setChecked(cid, true, false)
            }
          }
        }
      } finally {
        nextTick(() => {
          syncingTreeCheck.value = false
        })
      }
    }

    const reloadGroupTables = async (groupId) => {
      const { data } = await getGroupTablesWithColumns(groupId)
      groupSelectedTables.value = data || []
      selectedTables.value = (data || []).map((t) => ({
        id: t.sourceTableId,
        name: t.tableName,
        tableName: t.tableName,
        comment: t.displayName,
        displayName: t.displayName,
        instanceName: t.schemaName,
        schemaName: t.schemaName,
        alias: t.alias,
        sourceTableId: t.sourceTableId,
        columns: t.columns,
      }))
      selectedColumns.value = (data || []).flatMap((t) =>
        (t.columns || []).map((c) => ({
          id: c.sourceFieldId,
          columnName: c.fieldName,
          displayName: c.displayName,
          tableId: t.sourceTableId,
          dataType: c.dataType,
          isPrimary: c.isPrimary,
          isNullable: c.isNullable,
        })),
      )
      nextTick(() => applyGroupTablesToRightTree())
    }
    
    // 当前DDL
    const currentDDL = ref('')
    
    // 处理表和字段的选择（check-strictly：勾选字段时同步勾选父表，才能加入分组）
    const handleTreeCheck = (data, checked) => {
      if (syncingTreeCheck.value) {
        return
      }
      if (data.isTable) {
        if (checked) {
          if (!selectedTables.value.some((t) => String(t.id) === String(data.id))) {
            selectedTables.value.push(data)
          }
          if (data.children && data.children.length > 0) {
            nextTick(() => {
              data.children.forEach(child => {
                tableTreeRef.value.setChecked(child.id, true, false)
                const columnInfo = {
                  id: child.columnId,
                  tableId: child.tableId || data.id,
                  tableName: data.name,
                  columnName: child.name,
                  displayName: child.comment || '',
                  dataType: child.dataType,
                  isPrimary: child.isPrimary,
                  isNullable: child.isNullable
                }
                if (!selectedColumns.value.some(c => String(c.id) === String(columnInfo.id) && String(c.tableId) === String(columnInfo.tableId))) {
                  selectedColumns.value.push(columnInfo)
                }
              })
            })
          }
        } else {
          // 取消选择表时，同时取消所有字段
          selectedTables.value = selectedTables.value.filter(t => String(t.id) !== String(data.id))
          
          // 在UI上取消选中所有子节点
          if (data.children && data.children.length > 0) {
            nextTick(() => {
              data.children.forEach(child => {
                tableTreeRef.value.setChecked(child.id, false, false)
              })
              
              // 从已选字段中移除
              selectedColumns.value = selectedColumns.value.filter(c => String(c.tableId) !== String(data.id))
            })
          }
        }
      } else {
        // 处理字段选择
        const columnInfo = {
          id: data.columnId,
          tableId: data.tableId,
          tableName: tableList.value.find(t => String(t.id) === String(data.tableId))?.tableName || '',
          columnName: data.name,
          displayName: data.comment || '',
          dataType: data.dataType,
          isPrimary: data.isPrimary,
          isNullable: data.isNullable,
        }
        
        if (checked) {
          if (!selectedColumns.value.some((c) => String(c.id) === String(columnInfo.id) && String(c.tableId) === String(columnInfo.tableId))) {
            selectedColumns.value.push(columnInfo)
          }
          // 只勾字段时也要把父表勾上，否则无法「添加到分组」
          const parentNode = transformedTables.value.find((t) => String(t.id) === String(data.tableId))
          if (parentNode) {
            if (!selectedTables.value.some((t) => String(t.id) === String(parentNode.id))) {
              selectedTables.value.push(parentNode)
            }
            nextTick(() => {
              if (tableTreeRef.value && !syncingTreeCheck.value) {
                syncingTreeCheck.value = true
                try {
                  tableTreeRef.value.setChecked(parentNode.id, true, false)
                } finally {
                  nextTick(() => {
                    syncingTreeCheck.value = false
                  })
                }
              }
            })
          }
        } else {
          selectedColumns.value = selectedColumns.value.filter(c => 
            !(String(c.id) === String(columnInfo.id) && String(c.tableId) === String(columnInfo.tableId))
          )
          // 该表已无勾选字段时，取消父表勾选
          const remain = selectedColumns.value.some((c) => String(c.tableId) === String(data.tableId))
          if (!remain) {
            selectedTables.value = selectedTables.value.filter((t) => String(t.id) !== String(data.tableId))
            nextTick(() => {
              if (tableTreeRef.value) {
                syncingTreeCheck.value = true
                try {
                  tableTreeRef.value.setChecked(data.tableId, false, false)
                } finally {
                  nextTick(() => {
                    syncingTreeCheck.value = false
                  })
                }
              }
            })
          }
        }
      }
    }
    
    // 获取数据库列表
    const getDbList = async () => {
      try {
        // 调用后端API获取数据库实例
        const { data } = await getInstances(route.query.id)
        dbList.value = data
      } catch (error) {
        console.error('获取数据库列表失败:', error)
        ElMessage.error('获取数据库列表失败')
      }
    }
    
    // 获取分组列表
    const getGroupList = async () => {
      try {
        // 调用后端API获取分组
        const { data } = await getTableGroupList({dbConfigId: route.query.id})
        groupList.value = data
      } catch (error) {
        console.error('获取分组列表失败:', error)
        ElMessage.error('获取分组列表失败')
      }
    }
    
    // 点击数据库节点：切换浏览实例后，恢复当前分组在该库下已选表的勾选
    const handleDbClick = async (data) => {
      selectedInstance.value = data
      
      nextTick(() => {
        if (dbTree.value) {
          dbTree.value.setCurrentKey(data.instanceName, true)
        }
      })

      const finishLoad = () => {
        // 切库会重建右侧树，需把当前分组草稿里属于本库的表重新勾上
        nextTick(() => applyGroupTablesToRightTree())
      }

      if (data.tables) {
        tableList.value = data.tables
        loading.value = false
        finishLoad()
      } else {
        loading.value = true
        await getTablesWithColumns(route.query.id, data.instanceName).then(res => {
          tableList.value = res.data || []
          for (let i = 0; i < dbList.value.length; i++) {
            const tables = dbList.value[i].instances
            for (let j = 0; j < tables.length; j++) {
              const table = tables[j]
              if (table.instanceName === data.instanceName) {
                table.tables = tableList.value
                break
              }
            }
          }
          finishLoad()
        }).catch(error => {
          console.error('获取表列表失败:', error)
          ElMessage.error('获取表列表失败')
        }).finally(() => {
          loading.value = false
        })
      }
    }
    
    // 全选表
    const handleSelectAll = () => {
      if (tableTreeRef.value) {
        // 先选中所有表
        const tableIds = transformedTables.value.map(table => table.id)
        tableTreeRef.value.setCheckedKeys(tableIds, false)
        
        // 更新选中的表
        selectedTables.value = [...transformedTables.value]
        selectedColumns.value = []
        
        // 再选中所有字段
        nextTick(() => {
          transformedTables.value.forEach(table => {
            if (table.children && table.children.length > 0) {
              table.children.forEach(child => {
                tableTreeRef.value.setChecked(child.id, true, false)
                // 添加字段到选中列表
                const columnInfo = {
                  id: child.columnId,
                  tableId: child.tableId || table.id,
                  tableName: table.name,
                  columnName: child.name,
                  displayName: child.comment || '',
                  dataType: child.dataType,
                  isPrimary: child.isPrimary,
                  isNullable: child.isNullable
                }
                selectedColumns.value.push(columnInfo)
              })
            }
          })
        })
      }
    }
    
    // 取消全选表
    const handleUnselectAll = () => {
      if (tableTreeRef.value) {
        tableTreeRef.value.setCheckedKeys([], false)
      }
      selectedTables.value = []
      selectedColumns.value = []
    }
    
    // 点击分组节点：切到默认浏览库（若有），并加载分组已选项；支持跨实例表
    const handleGroupNodeClick = async (data) => {
      if (data.id == selectedGroup.value?.id) {
        return
      }
      selectedGroup.value = data
      groupSelectedTables.value = []
      selectedTables.value = []
      selectedColumns.value = []

      const instances = dbList.value?.[0]?.instances || []
      // 优先默认浏览库；否则用分组内已有表的第一个 schema；再否则当前浏览实例
      let preferSchema = data.schemaName
      try {
        await reloadGroupTables(data.id)
        if (!preferSchema && groupSelectedTables.value.length > 0) {
          preferSchema = groupSelectedTables.value[0].schemaName
        }
      } catch (error) {
        console.error('加载分组表失败:', error)
        ElMessage.error('加载分组已选项失败')
      }

      if (preferSchema) {
        const matched = instances.filter(it => it.instanceName === preferSchema)
        if (matched.length > 0) {
          await handleDbClick(matched[0])
          nextTick(() => {
            if (dbTree.value) {
              try {
                dbTree.value.setCurrentKey(preferSchema, true)
              } catch (error) {
                console.warn('设置数据库树高亮失败:', error)
              }
            }
          })
        } else {
          ElMessage.warning(`未找到数据库实例：${preferSchema}，请在「数据库」中手动切换`)
        }
      } else if (selectedInstance.value) {
        nextTick(() => applyGroupTablesToRightTree())
      }
    }
    
    // 点击分组中的表
    const handleGroupTableClick = (table) => {
      groupContentTab.value = 'groupColumns'
      // 仅显示该表的字段
      groupSelectedColumns.value = (selectedGroup.value.columns || [])
        .filter(col => col.tableId === table.id)
    }
    
    // 从分组中移除项（表或字段）
    const handleRemoveFromGroup = (data, node) => {
      const isTable = !node.parent || node.parent.level === 0
      
      if (isTable) {
        // 移除表
        ElMessageBox.confirm(`确认从 ${selectedGroup.value.groupName} 分组中移除 ${data.tableName} 表吗？`, '提示', {
          type: 'warning'
        }).then(async () => {
          try {
            // 仅改本地草稿，点「保存分组」后才落库
            const index = groupSelectedTables.value.findIndex(t => t.sourceTableId === data.sourceTableId)
            if (index > -1) {
              groupSelectedTables.value.splice(index, 1)
            }
            
            // 同步取消右侧表的选中状态
            if (tableTreeRef.value) {
              tableTreeRef.value.setChecked(data.sourceTableId, false)
            }
            
            // 更新选中表的数据
            selectedTables.value = selectedTables.value.filter(t => t.id !== data.sourceTableId)
            // 更新选中的列
            selectedColumns.value = selectedColumns.value.filter(c => c.tableId !== data.sourceTableId)
            ElMessage.success('已从分组草稿移除该表，请点击「保存分组」写入数据库')
          } catch (error) {
            console.error('移除表失败:', error)
            ElMessage.error('移除表失败')
          }
        })
      } else {
        // 移除字段
        ElMessageBox.confirm(`确认从 ${selectedGroup.value.groupName} 分组中移除此字段吗？`, '提示', {
          type: 'warning'
        }).then(async () => {
          try {
            // 找到父表
            const parentTable = groupSelectedTables.value.find(t => t.sourceTableId === data.sourceTableId)
            if (parentTable && parentTable.columns) {
              // 从父表的children中移除
              const childIndex = parentTable.columns.findIndex(c => c.sourceFieldId === data.sourceFieldId)
              if (childIndex > -1) {
                parentTable.columns.splice(childIndex, 1)
              }
              
              // 同步取消右侧字段的选中状态
              if (tableTreeRef.value) {
                tableTreeRef.value.setChecked(data.sourceFieldId, false)
              }
              
              // 更新选中字段的数据
              selectedColumns.value = selectedColumns.value.filter(c => 
                !(c.id === data.sourceFieldId && c.tableId === data.sourceTableId)
              )
            }
            
            ElMessage.success('已从分组草稿移除该字段，请点击「保存分组」写入数据库')
          } catch (error) {
            console.error('移除字段失败:', error)
            ElMessage.error('移除字段失败')
          }
        })
      }
    }
    
    // 新增分组
    const handleAddGroup = () => {
      groupDialogType.value = 'add'
      Object.assign(groupForm, {
        id: undefined,
        groupName: '',
        schemaName: selectedInstance.value?.instanceName || '',
        description: '',
        orderNum: 0,
        isPublic: 1,
      })
      groupDialogVisible.value = true
    }
    
    // 编辑分组
    const handleEditGroup = (row) => {
      groupDialogType.value = 'edit'
      Object.assign(groupForm, {
        id: row.id,
        groupName: row.groupName,
        schemaName: row.schemaName,
        description: row.description,
        orderNum: row.orderNum,
        isPublic: row.isPublic == null ? 1 : row.isPublic,
      })
      groupDialogVisible.value = true
    }
    
    // 删除分组
    const handleDeleteGroup = (row) => {
      ElMessageBox.confirm('确认删除该分组吗？', '提示', {
        type: 'warning'
      }).then(async () => {
        try {
          // 调用后端API删除分组数据
          await deleteTableGroup({ids: row.id})
          ElMessage.success('删除成功')
          getGroupList()
          
          // 如果删除的是当前选中的分组，清空选择
          if (selectedGroup.value && selectedGroup.value.id === row.id) {
            selectedGroup.value = null
            groupSelectedTables.value = []
            groupSelectedColumns.value = []
          }
        } catch (error) {
          console.error('删除分组失败:', error)
          ElMessage.error('删除分组失败')
        }
      })
    }
    
    // 提交分组表单
    const handleGroupSubmit = async () => {
      if (!groupFormRef.value) return
      
      await groupFormRef.value.validate(async (valid) => {
        if (valid) {
          try {
            if (groupDialogType.value === 'add') {
              await editTableGroup({
                groupName: groupForm.groupName,
                schemaName: groupForm.schemaName,
                description: groupForm.description,
                orderNum: groupForm.orderNum,
                isPublic: groupForm.isPublic,
                dbConfigId: route.query.id
              })
            } else {
              await editTableGroup({
                id: groupForm.id,
                groupName: groupForm.groupName,
                schemaName: groupForm.schemaName,
                description: groupForm.description,
                orderNum: groupForm.orderNum,
                isPublic: groupForm.isPublic,
              })
            }
            ElMessage.success(groupDialogType.value === 'add' ? '新增成功' : '更新成功')
            groupDialogVisible.value = false
            await getGroupList()
            if (groupDialogType.value === 'edit' && selectedGroup.value?.id === groupForm.id) {
              const refreshed = groupList.value.find((g) => g.id === groupForm.id)
              if (refreshed) {
                selectedGroup.value = refreshed
              }
            }
          } catch (error) {
            console.error('保存分组失败:', error)
            ElMessage.error(error?.msg || error?.message || '保存分组失败')
          }
        }
      })
    }
    
    // 刷新表列表
    const handleRefresh = () => {
      const currentNode = dbTree.value?.getCurrentNode?.() || selectedInstance.value
      if (currentNode && currentNode.instanceName) {
        // 清空缓存强制重新拉取
        currentNode.tables = null
        handleDbClick(currentNode)
      } else if (selectedGroup.value?.schemaName) {
        const instances = dbList.value?.[0]?.instances || []
        const matched = instances.find(it => it.instanceName === selectedGroup.value.schemaName)
        if (matched) {
          matched.tables = null
          handleDbClick(matched)
        } else {
          ElMessage.warning('请先选择一个数据库')
        }
      } else {
        ElMessage.warning('请先选择一个数据库或分组')
      }
    }
    
    // 返回上一页
    const handleBack = async () => {
      await backToListPage(route, router, {
        listRouteName: 'DbConfig',
        fallbackPath: '/visual/dbConfig',
      })
    }

    /** 跳转查询视图（可带当前连接与已选分组） */
    const handleGoQueryView = () => {
      const query = {}
      if (route.query.id) {
        query.dbConfigId = String(route.query.id)
      }
      if (selectedGroup.value?.id != null) {
        query.groupId = String(selectedGroup.value.id)
      }
      router.push({
        name: 'QueryConfig',
        query,
      })
    }
    
    /**
     * 将右侧勾选的表合并进当前分组草稿（按 sourceTableId 去重；支持跨实例）
     * 仅勾选部分字段时，也会把父表一并加入（字段列表以勾选为准）
     */
    const handleDirectAddToGroup = () => {
      if (!selectedGroup.value) {
        ElMessage.warning('请先在左侧选择一个分组')
        leftActiveTab.value = 'groups'
        return
      }

      const checkedNodes = tableTreeRef.value?.getCheckedNodes?.(false) || []
      let tableNodes = checkedNodes.filter((n) => n.isTable)

      // 兜底：若只有字段被勾选（父表未进 checked），从字段反推父表
      if (!tableNodes.length && selectedColumns.value.length > 0) {
        const tableIdSet = new Set(selectedColumns.value.map((c) => String(c.tableId)))
        tableNodes = transformedTables.value.filter((t) => tableIdSet.has(String(t.id)))
      } else if (!tableNodes.length) {
        tableNodes = selectedTables.value.filter((t) => t?.isTable || t?.tableName || t?.name)
      }

      if (!tableNodes.length) {
        ElMessage.warning('请先在右侧勾选要加入分组的表或字段')
        return
      }

      // 按当前勾选字段裁剪：只勾了部分字段时，合并进分组的也只带这些字段
      const incomingTables = tableNodes.map((table) => {
        const colsOfTable = selectedColumns.value.filter(
          (c) => String(c.tableId) === String(table.id) || String(c.tableId) === String(table.sourceTableId),
        )
        const base = {
          ...table,
          schemaName: table.schemaName || table.instanceName || selectedInstance.value?.instanceName,
          instanceName: table.instanceName || table.schemaName || selectedInstance.value?.instanceName,
        }
        if (colsOfTable.length > 0) {
          return {
            ...base,
            columns: colsOfTable.map((c, idx) => ({
              id: c.id,
              sourceFieldId: c.id,
              fieldName: c.columnName || c.fieldName,
              displayName: c.displayName || '',
              dataType: c.dataType,
              isPrimary: c.isPrimary,
              isNullable: c.isNullable,
              orderNum: idx,
            })),
          }
        }
        return base
      })

      const beforeCount = groupSelectedTables.value.length
      groupSelectedTables.value = mergeGroupTables(groupSelectedTables.value, incomingTables)
      const added = Math.max(0, groupSelectedTables.value.length - beforeCount)
      ElMessage.success(
        added > 0
          ? `已合并 ${added} 张新表到「${selectedGroup.value.groupName}」，请保存分组`
          : `已按勾选更新字段，未新增重复表，请保存分组`,
      )
    }

    const saveGroup2DB = async () => {
      if (!selectedGroup.value) {
        ElMessage.warning('请先选择分组')
        return
      }
      const missingSchema = groupSelectedTables.value.find((t) => !t.schemaName)
      if (missingSchema) {
        ElMessage.warning(`表【${missingSchema.tableName}】缺少所属数据库信息，请重新添加`)
        return
      }
      try {
        await saveGroupTables2DB(selectedGroup.value.id, groupSelectedTables.value)
        await reloadGroupTables(selectedGroup.value.id)
        ElMessage.success('保存成功')
      } catch (error) {
        console.error('保存失败:', error)
        ElMessage.error(error?.msg || error?.message || '保存失败')
      }
    }
    
    // 查看DDL（使用表所属实例名）
    const handleViewDDL = async (row) => {
      try {
        const schema = row.instanceName || row.schemaName || selectedInstance.value?.instanceName
        if (!schema) {
          ElMessage.warning('无法确定表所属数据库实例')
          return
        }
        const { data } = await getTableDDL(route.query.id, schema, row.name)
        currentDDL.value = data.ddl

        ddlDialogVisible.value = true
      } catch (error) {
        console.error('获取表DDL失败:', error)
        ElMessage.error('获取表DDL失败')
      }
    }
    
    // 复制DDL
    const handleCopyDDL = () => {
      navigator.clipboard.writeText(currentDDL.value).then(() => {
        ElMessage.success('复制成功')
      }).catch(() => {
        ElMessage.error('复制失败')
      })
    }

    // 测试连接
    const handleTestConnection = async () => {
      const { data } = await testConnection(route.query.id)
      if (data.success) {
        ElMessage.success('连接成功')
      } else {
        ElMessage.error('连接失败')
      }
    }
    
    // 切换操作提示的可见性
    const tipVisible = ref(localStorage.getItem('dbCanvasTipVisible') !== 'false')
    const toggleTipVisible = () => {
      tipVisible.value = !tipVisible.value
      localStorage.setItem('dbCanvasTipVisible', tipVisible.value)
    }

    onMounted(() => {
      getDbList()
      getGroupList()
    })
    
    return {
      loading,
      dbSearchKeyword,
      searchKeyword,
      dbTree,
      groupTree,
      tableTreeRef,
      groupFormRef,
      leftActiveTab,
      groupContentTab,
      selectedGroup,
      groupSelectedTables,
      groupSelectedColumns,
      dbTreeProps,
      groupTreeProps,
      dbList,
      filteredDbList,
      tableList,
      transformedTables,
      selectedTables,
      selectedColumns,
      hasSelectedItems,
      hasSelectedItemsToAdd,
      groupList,
      instanceOptions,
      groupDialogVisible,
      groupDialogType,
      groupForm,
      groupRules,
      ddlDialogVisible,
      currentDDL,
      selectedInstance,
      handleDbClick,
      handleTreeCheck,
      handleGroupNodeClick,
      handleGroupTableClick,
      handleRemoveFromGroup,
      handleSelectAll,
      handleUnselectAll,
      handleAddGroup,
      handleEditGroup,
      handleDeleteGroup,
      handleGroupSubmit,
      handleRefresh,
      handleBack,
      handleGoQueryView,
      handleDirectAddToGroup,
      handleViewDDL,
      handleCopyDDL,
      handleTestConnection,
      saveGroup2DB,
      tipVisible,
      toggleTipVisible
    }
  }
})
</script>

<template>
  <div class="db-canvas-container">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="left">
        <el-button-group>
          <el-button type="primary" @click="handleTestConnection">
            <vab-icon icon="donut-chart-line" />
            测试连接
          </el-button>
          <el-button type="primary" @click="handleRefresh">
            <vab-icon icon="refresh-line" />
            刷新表
          </el-button>
        </el-button-group>
      </div>
      <div class="right">
        <el-button @click="handleBack">
          <vab-icon icon="arrow-left-line" />
          返回
        </el-button>
      </div>
    </div>

    <!-- 主体内容区 -->
    <div class="main-content">
      <!-- 左侧：默认展示当前连接下的分组 -->
      <div class="left-panel">
        <el-card class="box-card el-card-padding-0">
          <el-tabs v-model="leftActiveTab" tab-position="top" class="left-tabs">
            <!-- 分组管理（默认） -->
            <el-tab-pane label="分组" name="groups">
              <div class="group-container">
                <div class="tab-content" style="height: 400px;">
                  <div class="card-header">
                    <el-button type="primary" link @click="handleAddGroup">
                      <vab-icon icon="add-line" />
                      新增分组
                    </el-button>
                    <el-tooltip
                      effect="dark"
                      content="分组可跨多个数据库实例混入表；默认浏览库用于选中分组时自动切库"
                      placement="top"
                    >
                      <vab-icon icon="information-line" class="info-icon" />
                    </el-tooltip>
                  </div>
                  <el-alert
                    title="先选分组 → 切换数据库勾选表字段 → 添加到分组并保存（支持多库表）"
                    type="info"
                    :closable="false"
                    show-icon
                    style="margin-bottom: 10px;"
                  />
                  <div class="tab-body group-tree-body">
                    <el-tree
                      ref="groupTree"
                      :data="groupList"
                      :props="groupTreeProps"
                      node-key="id"
                      highlight-current
                      @node-click="handleGroupNodeClick"
                    >
                      <template #default="{ node, data }">
                        <div class="custom-tree-node">
                          <span class="group-label">
                            <vab-icon icon="folder-line" />
                            <span class="group-name">{{ node.label }}</span>
                            <el-tag v-if="data.schemaName" size="small" type="info" class="schema-tag">
                              {{ data.schemaName }}
                            </el-tag>
                            <el-tag v-if="data.isPublic === 0" size="small" type="warning" class="schema-tag">
                              私有
                            </el-tag>
                          </span>
                          <span class="actions">
                            <el-button link @click.stop="handleEditGroup(data)">
                              <vab-icon icon="edit-line" />
                            </el-button>
                            <el-button link @click.stop="handleDeleteGroup(data)">
                              <vab-icon icon="delete-bin-line" />
                            </el-button>
                          </span>
                        </div>
                      </template>
                    </el-tree>
                    <el-empty v-if="groupList.length === 0" description="暂无分组，请先新增" :image-size="60" />
                  </div>
                </div>

                <div class="group-content-display" v-if="selectedGroup">
                  <h4>
                    {{ selectedGroup.groupName }}
                    <el-tag v-if="selectedGroup.schemaName" size="small" type="warning" style="margin-left: 6px;">
                      默认：{{ selectedGroup.schemaName }}
                    </el-tag>
                    <small>已选项（可含多库）</small>
                  </h4>
                  <el-tree
                    :data="groupSelectedTables"
                    node-key="sourceTableId"
                    :props="{
                      label: 'tableName',
                      children: 'columns'
                    }"
                  >
                    <template #default="{ node, data }">
                      <div class="group-tree-node">
                        <span>{{ data.tableName || data.fieldName || data.name }}</span>
                        <el-tag
                          v-if="data.schemaName && (data.tableName || data.sourceTableId)"
                          size="small"
                          type="info"
                          style="margin-left: 4px;"
                        >
                          {{ data.schemaName }}
                        </el-tag>
                        <span class="node-comment" v-if="data.displayName">({{ data.displayName }})</span>
                        <el-button
                          type="danger"
                          link
                          size="small"
                          class="delete-btn"
                          @click.stop="handleRemoveFromGroup(data, node)"
                          title="移除"
                        >
                          <vab-icon icon="delete-bin-line" />
                        </el-button>
                      </div>
                    </template>
                  </el-tree>
                  <el-empty v-if="groupSelectedTables.length === 0" description="暂无数据" />
                </div>
                <el-empty v-else description="请选择一个分组" style="margin-top: 20px;" />
              </div>
            </el-tab-pane>

            <!-- 数据库实例（浏览/切换源库） -->
            <el-tab-pane label="数据库" name="database">
              <div class="tab-content">
                <div class="card-header">
                  <el-input
                    v-model="dbSearchKeyword"
                    placeholder="搜索数据库"
                    clearable
                    style="width: 100%"
                  >
                    <template #prefix>
                      <vab-icon icon="search-line" />
                    </template>
                  </el-input>
                </div>
                <div class="tip-container">
                  <div class="tip-header" @click="toggleTipVisible">
                    <span>操作提示</span>
                    <vab-icon :icon="tipVisible ? 'arrow-up-s-line' : 'arrow-down-s-line'" />
                  </div>
                  <el-collapse-transition>
                    <div v-show="tipVisible" class="tip-content">
                      <p>1. 在「分组」中选择或新建分组（可跨多库混入表）</p>
                      <p>2. 在「数据库」中切换实例，勾选表/字段</p>
                      <p>3. 点击「添加到分组」合并到草稿，再「保存分组」</p>
                      <p>4. 切换库后回切，已加入分组的表会自动勾选</p>
                    </div>
                  </el-collapse-transition>
                </div>
                <div class="tab-body">
                  <el-tree
                    ref="dbTree"
                    :data="filteredDbList"
                    :props="dbTreeProps"
                    node-key="instanceName"
                    highlight-current
                    default-expand-all
                    @node-click="handleDbClick"
                  >
                    <template #default="{ node, data }">
                      <div class="custom-tree-node">
                        <span>
                          <vab-icon :icon="data.type === 'instance' ? 'database-2-line' : 'table-line'" />
                          {{ node.label }}
                        </span>
                      </div>
                    </template>
                  </el-tree>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>

      <!-- 右侧表列表和字段内容区 -->
      <div class="right-content">
        <el-card class="box-card el-card-padding-0">
          <template #header>
            <div class="card-header">
              <div class="header-title">
                <span>数据表</span>
                <el-tag v-if="selectedGroup" size="small" type="success" style="margin-left: 8px;">
                  支持多库表
                </el-tag>
                <el-tag v-if="selectedGroup?.schemaName" size="small" type="warning" style="margin-left: 8px;">
                  默认浏览：{{ selectedGroup.schemaName }}
                </el-tag>
                <el-tag v-else-if="selectedInstance?.instanceName" size="small" type="info" style="margin-left: 8px;">
                  当前浏览：{{ selectedInstance.instanceName }}
                </el-tag>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="handleDirectAddToGroup" 
                  :disabled="!selectedGroup"
                  class="direct-add-btn"
                >
                  <vab-icon icon="add-line" />
                  添加到分组{{ selectedGroup ? '' : '(请先选择分组)' }}
                </el-button>

                <el-button 
                  type="primary" 
                  size="small" 
                  @click="saveGroup2DB"
                  :disabled="!selectedGroup"
                  class="direct-add-btn"
                >
                  <vab-icon icon="database-2-line" />
                  保存分组
                </el-button>
              </div>
              <div class="header-actions">
                <el-input
                  v-model="searchKeyword"
                  placeholder="搜索表名"
                  clearable
                  style="width: 200px"
                >
                  <template #prefix>
                    <vab-icon icon="search-line" />
                  </template>
                </el-input>
                <el-button-group>
                  <el-button type="primary" @click="handleSelectAll">
                    <vab-icon icon="checkbox-circle-line" />
                    全选
                  </el-button>
                  <el-button type="primary" @click="handleUnselectAll">
                    <vab-icon icon="checkbox-blank-circle-line" />
                    取消全选
                  </el-button>
                </el-button-group>
              </div>
            </div>
          </template>
          
          <!-- 增强表和字段的层次感 -->
          <el-tree
            v-loading="loading"
            :data="transformedTables"
            node-key="id"
            :props="{
              label: 'name',
              children: 'children'
            }"
            highlight-current
            show-checkbox
            check-strictly
            @check-change="handleTreeCheck"
            ref="tableTreeRef"
          >
            <template #default="{ node, data }">
              <div class="custom-tree-node table-tree-node">
                <!-- 显示表或字段信息 -->
                <div class="node-info">
                  <vab-icon :icon="data.isTable ? 'table-line' : 'file-list-line'" />
                  <span class="node-label">{{ node.label }}</span>
                  <span class="node-comment" v-if="data.comment">{{ data.comment }}</span>
                </div>
                
                <!-- 表节点的操作按钮 -->
                <div class="node-actions" v-if="data.isTable">
                  <el-button type="primary" link @click.stop="handleViewDDL(data)" title="查看DDL">
                    <vab-icon icon="code-line" />
                  </el-button>
                </div>
                
                <!-- 字段节点的类型信息 -->
                <div class="node-type" v-else>
                  <el-tag size="small" :type="data.isPrimary ? 'danger' : ''">
                    {{ data.dataType }}
                  </el-tag>
                  <el-tag v-if="data.isPrimary" size="small" type="warning" style="margin-left: 4px;">主键</el-tag>
                </div>
              </div>
            </template>
          </el-tree>
        </el-card>
      </div>
    </div>

    <!-- 分组表单对话框 -->
    <el-dialog
      v-model="groupDialogVisible"
      :title="groupDialogType === 'add' ? '新增分组' : '编辑分组'"
      width="500px"
      destroy-on-close
    >
      <el-form
        ref="groupFormRef"
        :model="groupForm"
        :rules="groupRules"
        label-width="80px"
      >
        <el-form-item label="分组名称" prop="groupName">
          <el-input v-model="groupForm.groupName" placeholder="请输入分组名称" />
        </el-form-item>
        <el-form-item label="默认浏览库" prop="schemaName">
          <el-select
            v-model="groupForm.schemaName"
            placeholder="选中分组时自动切换到该库（可选，仍可跨库加表）"
            clearable
            style="width: 100%"
          >
            <el-option
              v-for="item in instanceOptions"
              :key="item.instanceName"
              :label="item.instanceName"
              :value="item.instanceName"
            />
          </el-select>
          <div class="form-tip">仅影响打开分组时的默认浏览库，分组内可包含多个实例的表</div>
        </el-form-item>
        <el-form-item label="可见范围">
          <el-switch
            v-model="groupForm.isPublic"
            :active-value="1"
            :inactive-value="0"
            active-text="公开"
            inactive-text="仅自己"
          />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="groupForm.description" type="textarea" :rows="3" placeholder="请输入描述" />
        </el-form-item>
        <el-form-item label="排序" prop="orderNum">
          <el-input-number v-model="groupForm.orderNum" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleGroupSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- DDL查看对话框 -->
    <el-dialog
      v-model="ddlDialogVisible"
      title="表结构"
      width="800px"
      destroy-on-close
    >
      <el-input
        v-model="currentDDL"
        type="textarea"
        :rows="15"
        readonly
      />
      <template #footer>
        <el-button @click="ddlDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleCopyDDL">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.db-canvas-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  
  .toolbar {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  
  .main-content {
    display: flex;
    flex: 1;
    gap: 20px;
    min-height: 0;
    
    .el-card-padding-0 {
      :deep(.el-card__body) {
        padding: 10px;
        background-color: var(--el-bg-color);
      }
    }

    .tip-content {
      font-size: 12px;
      line-height: 1.4;
      color: var(--el-text-color-regular);
      
      p {
        margin: 3px 0;
      }
    }
    
    .left-panel {
      flex-shrink: 0;
      width: 25%;
      background-color: transparent;

      :deep(.el-card),
      :deep(.el-tabs),
      :deep(.el-tabs__content),
      :deep(.el-tab-pane) {
        background-color: var(--el-bg-color);
      }

      :deep(.el-tabs__header) {
        background-color: var(--el-bg-color);
      }

      :deep(.el-tree) {
        background-color: transparent;
        color: var(--el-text-color-primary);
      }
      
      .info-icon {
        margin-left: 8px;
        font-size: 16px;
        color: var(--el-color-info);
        cursor: pointer;
      }
      
      .tab-content {
        display: flex;
        flex-direction: column;
        
        .card-header {
          padding-top: 12px;
          margin-bottom: 16px;
        }
        
        .tab-body {
          flex: 1;
          overflow: auto;
        }
        
        .group-tree-body {
          height: 220px;
          overflow: auto;
          background-color: var(--el-fill-color-blank);
          border: 1px solid var(--el-border-color-lighter);
          border-radius: 4px;
        }
      }
      
      .custom-tree-node {
        display: flex;
        gap: 4px;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding-right: 4px;
        font-size: 14px;

        .group-label {
          display: flex;
          gap: 4px;
          align-items: center;
          min-width: 0;

          .group-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .schema-tag {
            flex-shrink: 0;
          }
        }
        
        .actions {
          display: none;
          flex-shrink: 0;
        }
        
        &:hover .actions {
          display: inline-block;
        }
      }
      
      .group-content-display {
        flex: 1;
        padding: 12px;
        margin-top: 12px;
        overflow-y: auto;
        background-color: var(--el-fill-color-blank);
        border: 1px solid var(--el-border-color-lighter);
        border-top: 1px solid var(--el-border-color-light);
        border-radius: 4px;

        h4 {
          margin: 0 0 10px;
          font-size: 14px;
          color: var(--el-text-color-secondary);
          
          small {
            font-weight: normal;
            color: var(--el-text-color-placeholder);
          }
        }
        
        .group-tree-node {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          width: 100%;
          
          .node-comment {
            margin-left: 5px;
            font-size: 0.9em;
            color: var(--el-text-color-secondary);
          }
          
          .delete-btn {
            padding: 2px;
            margin-left: auto;
          }
        }

        .group-content-tabs {
          height: 100%;
          
          :deep(.el-tabs__content) {
            height: calc(100% - 40px);
            padding-top: 5px;
            overflow: auto;
          }
          
          .el-table {
            --el-table-header-bg-color: var(--el-fill-color-light);
          }
        }
      }
      
      .tip-container {
        margin-bottom: 15px;
        overflow: hidden;
        background-color: var(--el-color-info-light);
        border: 1px solid var(--el-border-color-light);
        border-radius: 4px;
        
        .tip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 15px;
          font-weight: bold;
          color: var(--el-color-info-dark);
          cursor: pointer;
          background-color: var(--el-color-info-light);
          
          &:hover {
            background-color: var(--el-color-info-lighter);
          }
        }
        
        .tip-content {
          padding: 10px 15px;
          font-size: 12px;
          line-height: 1.5;
          background-color: var(--el-fill-color-blank);
          border-top: 1px solid var(--el-border-color-light);
          
          p {
            margin: 5px 0;
          }
        }
      }
    }
    
    .right-content {
      flex: 1;
      min-width: 0;
      
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        
        .header-title {
          display: flex;
          gap: 12px;
          align-items: center;
          
          .direct-add-btn {
            margin-left: 8px;
          }
        }
        
        .header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }
      }
      
      .table-tree-node {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 6px 0;
        
        .node-info {
          display: flex;
          gap: 8px;
          align-items: center;
          
          .node-label {
            font-weight: bold;
          }
          
          .node-comment {
            margin-left: 8px;
            color: var(--el-text-color-secondary);
          }
        }
        
        .node-type {
          font-size: 12px;
        }
      }
    }
  }
  
  :deep(.el-card) {
    display: flex;
    flex-direction: column;
    height: 100%;
    
    .el-card__body {
      flex: 1;
      overflow: hidden;
    }
    
  }

  .form-tip {
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
</style> 