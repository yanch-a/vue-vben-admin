<script>
  import {
    computed,
    defineComponent,
    inject,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    watch,
  } from 'vue'
  import { useRoute, useRouter } from 'vue-router'

  import { getInstances, getTables } from '@/api/visual/database'
  import {
    findBestRelationshipPath,
    getCatalogTablesLight,
    getDbConfigById,
    getTablesWithColumnsByIds,
    loadRelationCanvas,
    saveRelationCanvas,
    syncTableToCatalog,
  } from '@/api/visual/vq'
  import LogicFlow from '@/utils/logicflow'
  import { backToListPage } from '@/utils/route-back'
  import { ArrowLeft, Search } from '@element-plus/icons-vue'

  const NODE_TYPE = 'table-node'
  const LIST_ITEM_HEIGHT = 72
  const VIRTUAL_BUFFER = 8

  export default defineComponent({
    name: 'RelationCanvas',
    setup() {
      const route = useRoute()
      const router = useRouter()
      const $baseMessage = inject('$baseMessage')

      const dbConfigId = route.query.id
      const dbConfigName = ref('')
      const canvasRef = ref(null)
      const catalogScrollRef = ref(null)
      const saving = ref(false)
      const tableFilter = ref('')
      const remoteLoading = ref(false)
      const syncingTableName = ref('')

      /** 远端实例 / 当前 schema */
      const schemaOptions = ref([])
      const currentSchema = ref('')
      /** 远端表（仅名称，轻量） */
      const remoteTables = ref([])
      /** 本地目录：sourceTableId -> { id, tableName, schemaName, ... } */
      const catalogBySourceId = reactive({})
      /** tableId -> 完整表（含字段），供画布/映射使用 */
      const tableMap = reactive({})
      /** 画布上当前节点 id 集合（响应式，驱动左侧状态标签） */
      const canvasTableIds = ref(new Set())
      /** 多选模式：开启后单击叠加选中，便于寻路测试 */
      const multiSelectMode = ref(false)
      /** 内部维护的多选 id 列表（LogicFlow 默认单击会清空，需自行叠加） */
      let lastSelectedIds = []

      const selectedNodeIds = ref([])
      const pathDialogVisible = ref(false)
      const pathResult = ref(null)

      /** 左侧表右键菜单 */
      const ctxMenu = reactive({
        visible: false,
        x: 0,
        y: 0,
        table: null,
      })

      const edgeDialogVisible = ref(false)
      /** 当前编辑中的边 id；新建取消时用于回滚删除 */
      let editingEdgeId = null
      let editingIsNew = false
      const edgeForm = reactive({
        sourceTableId: null,
        targetTableId: null,
        relationshipName: '',
        joinType: 'INNER',
        relationshipType: 'ONE_TO_MANY',
        description: '',
        fields: [],
      })
      const joinOperators = ['=', '!=', '>', '<', '>=', '<=']

      let lf = null
      /** 加载画布数据期间不响应 edge:add */
      let restoring = false

      /** 虚拟列表窗口 */
      const virtualStart = ref(0)
      const virtualCount = ref(24)

      const buildSourceId = (tableName, schema = currentSchema.value) =>
        `${schema}-${dbConfigId}-${tableName}`

      const filteredRemoteTables = computed(() => {
        const kw = tableFilter.value.trim().toLowerCase()
        if (!kw) return remoteTables.value
        return remoteTables.value.filter(
          (t) =>
            (t.tableName || '').toLowerCase().includes(kw) ||
            (t.displayName || '').toLowerCase().includes(kw)
        )
      })

      const virtualOffset = computed(() => virtualStart.value * LIST_ITEM_HEIGHT)

      const visibleRemoteTables = computed(() => {
        const list = filteredRemoteTables.value
        const start = virtualStart.value
        return list.slice(start, start + virtualCount.value)
      })

      const onCatalogScroll = () => {
        const el = catalogScrollRef.value
        if (!el) return
        const start = Math.max(0, Math.floor(el.scrollTop / LIST_ITEM_HEIGHT) - VIRTUAL_BUFFER)
        const viewport = Math.ceil(el.clientHeight / LIST_ITEM_HEIGHT) + VIRTUAL_BUFFER * 2
        virtualStart.value = start
        virtualCount.value = Math.max(viewport, 20)
      }

      watch(tableFilter, async () => {
        virtualStart.value = 0
        await nextTick()
        if (catalogScrollRef.value) {
          catalogScrollRef.value.scrollTop = 0
        }
        onCatalogScroll()
      })

      const tableLabel = (tableId) => {
        const t = tableMap[String(tableId)]
        return t
          ? t.displayName || t.tableName
          : String(tableId == null ? '' : tableId)
      }

      const fieldsOfTable = (tableId) => {
        const t = tableMap[String(tableId)]
        return t && t.columns ? t.columns : []
      }

      const fieldLabel = (f) =>
        f.displayName && f.displayName !== f.fieldName
          ? `${f.fieldName}（${f.displayName}）`
          : f.fieldName

      const nodeExists = (tableId) => {
        if (!lf) return false
        return !!lf.getNodeModelById(String(tableId))
      }

      const syncCanvasTableIds = () => {
        if (!lf) {
          canvasTableIds.value = new Set()
          return
        }
        const ids = new Set(
          (lf.getGraphRawData().nodes || []).map((n) => String(n.id))
        )
        canvasTableIds.value = ids
      }

      const isTableSynced = (table) => {
        const sid = buildSourceId(table.tableName)
        return !!catalogBySourceId[sid]
      }

      const isTableOnCanvas = (table) => {
        const sid = buildSourceId(table.tableName)
        const local = catalogBySourceId[sid]
        return !!(local && canvasTableIds.value.has(String(local.id)))
      }

      const ctxMenuOnCanvas = computed(() =>
        ctxMenu.table ? isTableOnCanvas(ctxMenu.table) : false
      )

      const closeCatalogContextMenu = () => {
        ctxMenu.visible = false
        ctxMenu.table = null
      }

      const openCatalogContextMenu = (event, table) => {
        ctxMenu.table = table
        const pad = 8
        const menuW = 140
        const menuH = 72
        let x = event.clientX
        let y = event.clientY
        if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad
        if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad
        ctxMenu.x = x
        ctxMenu.y = y
        ctxMenu.visible = true
      }

      const onGlobalClickCloseMenu = () => {
        if (ctxMenu.visible) closeCatalogContextMenu()
      }

      const onGlobalKeyCloseMenu = (e) => {
        if (e.key === 'Escape') closeCatalogContextMenu()
      }

      /** 从画布移除指定表节点（连带关系边） */
      const removeNodeFromCanvas = (tableId) => {
        if (!lf || tableId == null) return false
        const id = String(tableId)
        if (!lf.getNodeModelById(id)) return false
        lf.deleteNode(id)
        selectedNodeIds.value = selectedNodeIds.value.filter((n) => String(n) !== id)
        lastSelectedIds = selectedNodeIds.value.map(String)
        syncCanvasTableIds()
        return true
      }

      /** 删除画布上当前选中的表 */
      const deleteSelectedNodes = () => {
        if (!lf || edgeDialogVisible.value) return
        const { edges } = lf.getSelectElements(true)
        // 多选模式以下 selectedNodeIds 为准（LF 原生选中可能为空）
        const nodeIds =
          selectedNodeIds.value.length > 0
            ? selectedNodeIds.value.map(String)
            : (lf.getSelectElements(true).nodes || []).map((n) => String(n.id))

        if (!nodeIds.length && (!edges || !edges.length)) return

        for (const edge of edges || []) {
          lf.deleteEdge(edge.id)
        }
        for (const id of nodeIds) {
          if (lf.getNodeModelById(id)) {
            lf.deleteNode(id)
          }
        }
        selectedNodeIds.value = []
        lastSelectedIds = []
        syncCanvasTableIds()
        if (nodeIds.length) {
          $baseMessage(
            `已从画布移除 ${nodeIds.length} 张表`,
            'success',
            'vab-hey-message-success'
          )
        }
      }

      const onCanvasKeydown = (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const tag = (e.target && e.target.tagName) || ''
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          e.preventDefault()
          e.stopPropagation()
          deleteSelectedNodes()
        }
      }

      /** 全局 Delete：选中节点后即使焦点略偏也能删 */
      const onWindowKeydownDelete = (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        if (edgeDialogVisible.value || pathDialogVisible.value) return
        const el = e.target
        if (
          el &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.isContentEditable)
        ) {
          return
        }
        if (!lf) return
        const sel = lf.getSelectElements(true)
        if (
          (!sel.nodes || !sel.nodes.length) &&
          (!sel.edges || !sel.edges.length)
        ) {
          return
        }
        e.preventDefault()
        deleteSelectedNodes()
      }

      const ctxMenuAdd = async () => {
        const table = ctxMenu.table
        closeCatalogContextMenu()
        if (!table) return
        if (isTableOnCanvas(table)) {
          $baseMessage('该表已在画布上', 'info', 'vab-hey-message-info')
          return
        }
        await addRemoteTableToCanvas(table)
      }

      const ctxMenuRemove = () => {
        const table = ctxMenu.table
        closeCatalogContextMenu()
        if (!table) return
        const sid = buildSourceId(table.tableName)
        const local = catalogBySourceId[sid]
        if (!local || !nodeExists(local.id)) {
          $baseMessage('该表不在画布上', 'info', 'vab-hey-message-info')
          return
        }
        if (removeNodeFromCanvas(local.id)) {
          $baseMessage(
            `已从画布移除 ${table.displayName || table.tableName}`,
            'success',
            'vab-hey-message-success'
          )
        }
      }

      const rememberCatalogTable = (t) => {
        if (!t) return
        if (t.sourceTableId) {
          catalogBySourceId[t.sourceTableId] = {
            id: t.id,
            sourceTableId: t.sourceTableId,
            tableName: t.tableName,
            schemaName: t.schemaName,
            displayName: t.displayName,
          }
        }
        if (t.id != null) {
          tableMap[String(t.id)] = t
        }
      }

      /** 注册表节点：圆角矩形 + 两行文本 */
      const registerTableNode = () => {
        lf.register(NODE_TYPE, ({ RectNode, RectNodeModel, h }) => {
          class TableNodeView extends RectNode {
            getShape() {
              const { model } = this.props
              const { x, y, width, height, properties, isSelected } = model
              const style = model.getNodeStyle()
              // multiSelected：多选模式自管选中态，不依赖 LogicFlow 默认 isSelected
              const active = !!(isSelected || properties.multiSelected)
              return h('g', {}, [
                h('rect', {
                  ...style,
                  x: x - width / 2,
                  y: y - height / 2,
                  rx: 8,
                  ry: 8,
                  width,
                  height,
                  fill: '#ffffff',
                  stroke: active ? '#409eff' : '#5a78a0',
                  strokeWidth: active ? 2.5 : 1.5,
                }),
                h('rect', {
                  x: x - width / 2,
                  y: y - height / 2,
                  rx: 8,
                  ry: 8,
                  width,
                  height: 26,
                  fill: active ? '#409eff' : '#5a78a0',
                }),
                h(
                  'text',
                  {
                    x,
                    y: y - height / 2 + 17,
                    fill: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    textAnchor: 'middle',
                  },
                  properties.displayName || properties.tableName
                ),
                h(
                  'text',
                  {
                    x,
                    y: y + 8,
                    fill: '#606266',
                    fontSize: 12,
                    textAnchor: 'middle',
                  },
                  properties.tableName
                ),
                h(
                  'text',
                  {
                    x,
                    y: y + 26,
                    fill: '#909399',
                    fontSize: 11,
                    textAnchor: 'middle',
                  },
                  `${properties.fieldCount || 0} 个字段`
                ),
              ])
            }
          }
          class TableNodeModel extends RectNodeModel {
            initNodeData(data) {
              super.initNodeData(data)
              this.width = 170
              this.height = 78
              // 文本由自定义视图绘制
              this.text.editable = false
              if (this.text) this.text.value = ''
            }
          }
          return { view: TableNodeView, model: TableNodeModel }
        })
      }

      const edgeText = (props) => {
        const n = props.fields ? props.fields.length : 0
        return `${props.joinType || 'INNER'}${props.relationshipName ? ' · ' + props.relationshipName : ''}（${n} 映射）`
      }

      const initLogicFlow = () => {
        lf = new LogicFlow({
          container: canvasRef.value,
          grid: { size: 16, visible: true, type: 'dot' },
          keyboard: { enabled: false },
          // 原生：按住 Shift 点击可多选（Windows 上也可用我们自定义的 Ctrl）
          multipleSelectKey: 'shift',
          edgeType: 'polyline',
          adjustEdgeStartAndEnd: false,
          hoverOutline: false,
        })
        registerTableNode()

        // 手动连线后弹出字段映射编辑
        lf.on('edge:add', ({ data }) => {
          if (restoring) return
          if (data.sourceNodeId === data.targetNodeId) {
            lf.deleteEdge(data.id)
            $baseMessage(
              '不能创建自关联关系',
              'warning',
              'vab-hey-message-warning'
            )
            return
          }
          openEdgeDialog(data.id, true)
        })
        // 双击边再次编辑
        lf.on('edge:dbclick', ({ data }) => {
          openEdgeDialog(data.id, false)
        })

        let suppressSelectionSync = false

        /** 用节点属性 multiSelected 绘制多选高亮（彻底摆脱 LF 单击选中干扰） */
        const refreshMultiSelectVisual = () => {
          if (!lf) return
          const selected = new Set(lastSelectedIds.map(String))
          const raw = lf.getGraphRawData()
          ;(raw.nodes || []).forEach((n) => {
            const id = String(n.id)
            const model = lf.getNodeModelById(id)
            if (!model) return
            const on = selected.has(id)
            const props = model.properties || {}
            if (!!props.multiSelected !== on) {
              model.setProperties({ ...props, multiSelected: on })
            }
            // 清掉 LF 原生选中，避免和 multiSelected 叠两套样式
            if (typeof model.setSelected === 'function' && model.isSelected) {
              model.setSelected(false)
            }
          })
          if (typeof lf.clearSelectElements === 'function') {
            lf.clearSelectElements()
          }
        }

        const setMultiSelection = (ids) => {
          lastSelectedIds = [...new Set(ids.map(String))]
          selectedNodeIds.value = [...lastSelectedIds]
          suppressSelectionSync = true
          refreshMultiSelectVisual()
          nextTick(() => {
            refreshMultiSelectVisual()
            setTimeout(() => {
              refreshMultiSelectVisual()
              suppressSelectionSync = false
            }, 40)
          })
        }

        // 同一轮手势里 mousedown+click 可能各触发一次，防抖避免点一下被切换两次
        let lastToggleAt = 0
        let lastToggleId = ''
        const toggleMultiId = (id) => {
          const now = Date.now()
          if (lastToggleId === id && now - lastToggleAt < 350) {
            refreshMultiSelectVisual()
            return
          }
          lastToggleAt = now
          lastToggleId = id
          const set = new Set(lastSelectedIds.map(String))
          if (set.has(id)) {
            set.delete(id)
          } else {
            set.add(id)
          }
          setMultiSelection([...set])
        }

        const isMultiEvent = (e) =>
          multiSelectMode.value ||
          !!(e && (e.shiftKey || e.ctrlKey || e.metaKey))

        // mousedown：已选中再点也会触发（click 在部分情况下不会）
        lf.on('node:mousedown', ({ data, e }) => {
          if (!isMultiEvent(e)) return
          toggleMultiId(String(data.id))
        })

        // click：非多选走单选；多选时兜底 toggle（有防抖）
        lf.on('node:click', ({ data, e }) => {
          if (isMultiEvent(e)) {
            toggleMultiId(String(data.id))
            nextTick(() => canvasRef.value && canvasRef.value.focus())
            return
          }
          lastSelectedIds = [String(data.id)]
          selectedNodeIds.value = [...lastSelectedIds]
          const raw = lf.getGraphRawData()
          ;(raw.nodes || []).forEach((n) => {
            const model = lf.getNodeModelById(String(n.id))
            if (model?.properties?.multiSelected) {
              model.setProperties({ ...model.properties, multiSelected: false })
            }
          })
          nextTick(() => canvasRef.value && canvasRef.value.focus())
        })
        lf.on('blank:click', () => {
          setMultiSelection([])
          nextTick(() => canvasRef.value && canvasRef.value.focus())
        })
        lf.on('selection:selected', () => {
          if (suppressSelectionSync) return
          if (multiSelectMode.value) {
            // LF 默认选中会抢焦点，立刻用我们的 multiSelected 盖回去
            refreshMultiSelectVisual()
            return
          }
          const { nodes } = lf.getSelectElements(true)
          lastSelectedIds = (nodes || []).map((n) => String(n.id))
          selectedNodeIds.value = [...lastSelectedIds]
          nextTick(() => canvasRef.value && canvasRef.value.focus())
        })
        lf.on('node:delete', () => {
          const remain = new Set(
            (lf.getGraphRawData().nodes || []).map((n) => String(n.id))
          )
          lastSelectedIds = lastSelectedIds.filter((id) => remain.has(String(id)))
          selectedNodeIds.value = [...lastSelectedIds]
        })
        lf.on('edge:click', () => {
          nextTick(() => canvasRef.value && canvasRef.value.focus())
        })
      }

      const toggleMultiSelectMode = () => {
        multiSelectMode.value = !multiSelectMode.value
        if (multiSelectMode.value) {
          // 把当前单选带进多选列表
          if (lf) {
            const { nodes } = lf.getSelectElements(true)
            const ids = (nodes || []).map((n) => String(n.id))
            if (ids.length) {
              lastSelectedIds = ids
              selectedNodeIds.value = ids
            }
            // 刷 multiSelected 视觉并清掉原生选中
            const selected = new Set(lastSelectedIds.map(String))
            const raw = lf.getGraphRawData()
            ;(raw.nodes || []).forEach((n) => {
              const model = lf.getNodeModelById(String(n.id))
              if (!model) return
              model.setProperties({
                ...model.properties,
                multiSelected: selected.has(String(n.id)),
              })
              if (typeof model.setSelected === 'function') {
                model.setSelected(false)
              }
            })
            if (typeof lf.clearSelectElements === 'function') {
              lf.clearSelectElements()
            }
          }
        } else {
          // 退出多选：清掉 multiSelected 标记
          if (lf) {
            const raw = lf.getGraphRawData()
            ;(raw.nodes || []).forEach((n) => {
              const model = lf.getNodeModelById(String(n.id))
              if (model?.properties?.multiSelected) {
                model.setProperties({ ...model.properties, multiSelected: false })
              }
            })
          }
        }
        $baseMessage(
          multiSelectMode.value
            ? '已开启多选：点击表可叠加选中，再点一次取消选中'
            : '已退出多选模式',
          'info',
          'vab-hey-message-info'
        )
      }

      const openEdgeDialog = async (edgeId, isNew) => {
        const edge = lf.getEdgeModelById(edgeId)
        if (!edge) return
        editingEdgeId = edgeId
        editingIsNew = isNew
        // 确保两端表字段已加载（关系编辑依赖字段下拉）
        const needLoad = [edge.sourceNodeId, edge.targetNodeId].filter((id) => {
          const t = tableMap[String(id)]
          return !t || !t.columns || !t.columns.length
        })
        if (needLoad.length) {
          try {
            const { data } = await getTablesWithColumnsByIds(needLoad.map(String))
            for (const t of data || []) {
              rememberCatalogTable(t)
            }
          } catch (e) {
            console.warn('加载表字段失败', e)
          }
        }
        const props = edge.properties || {}
        // 保持字符串，避免雪花ID超出 JS Number 精度
        edgeForm.sourceTableId = edge.sourceNodeId
        edgeForm.targetTableId = edge.targetNodeId
        edgeForm.relationshipName = props.relationshipName || ''
        edgeForm.joinType = props.joinType || 'INNER'
        edgeForm.relationshipType = props.relationshipType || 'ONE_TO_MANY'
        edgeForm.description = props.description || ''
        edgeForm.fields =
          props.fields && props.fields.length
            ? props.fields.map((f) => ({
                ...f,
                isPrimaryMapping: !!f.isPrimaryMapping,
              }))
            : [
                {
                  sourceFieldId: null,
                  targetFieldId: null,
                  operator: '=',
                  isPrimaryMapping: true,
                },
              ]
        edgeDialogVisible.value = true
      }

      const addMapping = () => {
        edgeForm.fields.push({
          sourceFieldId: null,
          targetFieldId: null,
          operator: '=',
          isPrimaryMapping: false,
        })
      }

      const removeMapping = (idx) => {
        edgeForm.fields.splice(idx, 1)
      }

      const confirmEdge = () => {
        const valid = edgeForm.fields.filter(
          (f) => f.sourceFieldId && f.targetFieldId
        )
        if (!valid.length) {
          $baseMessage(
            '至少配置一组完整的字段映射',
            'warning',
            'vab-hey-message-warning'
          )
          return
        }
        const props = {
          relationshipName: edgeForm.relationshipName,
          joinType: edgeForm.joinType,
          relationshipType: edgeForm.relationshipType,
          description: edgeForm.description,
          fields: valid.map((f) => ({
            sourceFieldId: f.sourceFieldId,
            targetFieldId: f.targetFieldId,
            operator: f.operator || '=',
            isPrimaryMapping: f.isPrimaryMapping ? 1 : 0,
          })),
        }
        const edge = lf.getEdgeModelById(editingEdgeId)
        if (edge) {
          edge.setProperties(props)
          lf.updateText(editingEdgeId, edgeText(props))
        }
        edgeDialogVisible.value = false
        editingEdgeId = null
      }

      const cancelEdgeDialog = () => {
        // 新建连线取消时回滚
        if (editingIsNew && editingEdgeId) {
          lf.deleteEdge(editingEdgeId)
        }
        edgeDialogVisible.value = false
        editingEdgeId = null
      }

      const deleteEdge = () => {
        if (editingEdgeId) {
          lf.deleteEdge(editingEdgeId)
        }
        edgeDialogVisible.value = false
        editingEdgeId = null
      }

      /** 远端表点击：按需同步入库后加入画布 */
      const addRemoteTableToCanvas = async (remoteTable) => {
        if (!currentSchema.value) {
          $baseMessage('请先选择数据库', 'warning', 'vab-hey-message-warning')
          return
        }
        const sourceId = buildSourceId(remoteTable.tableName)
        let local = catalogBySourceId[sourceId]
          ? tableMap[String(catalogBySourceId[sourceId].id)]
          : null

        if (local && nodeExists(local.id)) {
          $baseMessage('该表已在画布上', 'info', 'vab-hey-message-info')
          return
        }

        try {
          if (!local || !local.columns || !local.columns.length) {
            syncingTableName.value = remoteTable.tableName
            const { data } = await syncTableToCatalog({
              dbConfigId,
              schemaName: currentSchema.value,
              tableName: remoteTable.tableName,
              displayName: remoteTable.displayName || remoteTable.tableName,
            })
            local = data
            rememberCatalogTable(local)
          }
          if (!local?.id) {
            $baseMessage('同步表失败', 'error', 'vab-hey-message-error')
            return
          }
          if (nodeExists(local.id)) {
            $baseMessage('该表已在画布上', 'info', 'vab-hey-message-info')
            return
          }
          const count = lf.getGraphRawData().nodes.length
          lf.addNode(
            buildNode(
              local,
              220 + (count % 4) * 220,
              120 + Math.floor(count / 4) * 140
            )
          )
          syncCanvasTableIds()
        } catch (e) {
          console.error(e)
          $baseMessage(
            e?.msg || e?.message || '同步并加入画布失败',
            'error',
            'vab-hey-message-error'
          )
        } finally {
          syncingTableName.value = ''
        }
      }

      const buildNode = (table, x, y) => ({
        id: String(table.id),
        type: NODE_TYPE,
        x,
        y,
        properties: {
          tableId: table.id,
          tableName: table.tableName,
          displayName: table.displayName,
          fieldCount: table.columns ? table.columns.length : 0,
          multiSelected: false,
        },
      })

      const loadRemoteTables = async () => {
        if (!currentSchema.value) {
          remoteTables.value = []
          return
        }
        remoteLoading.value = true
        try {
          const { data } = await getTables(dbConfigId, currentSchema.value)
          remoteTables.value = data || []
          virtualStart.value = 0
          await nextTick()
          onCatalogScroll()
        } catch (e) {
          console.error(e)
          remoteTables.value = []
          $baseMessage('加载远端表列表失败', 'error', 'vab-hey-message-error')
        } finally {
          remoteLoading.value = false
        }
      }

      const handleSchemaChange = async () => {
        tableFilter.value = ''
        await loadRemoteTables()
      }

      /** 加载：远端实例 + 轻量本地目录 + 画布关系（按需加载字段） */
      const loadData = async () => {
        const [{ data: config }, { data: instanceTree }, { data: lightCatalog }, { data: relationships }] =
          await Promise.all([
            getDbConfigById({ id: dbConfigId }),
            getInstances(dbConfigId),
            getCatalogTablesLight(dbConfigId),
            loadRelationCanvas(dbConfigId),
          ])
        dbConfigName.value = config ? config.dbName : ''

        // 实例列表
        const instances = instanceTree?.[0]?.instances || []
        schemaOptions.value = instances.map((i) => i.instanceName).filter(Boolean)
        const defaultSchema =
          config?.schemaName && schemaOptions.value.includes(config.schemaName)
            ? config.schemaName
            : schemaOptions.value[0] || ''
        currentSchema.value = defaultSchema

        // 轻量本地目录索引
        Object.keys(catalogBySourceId).forEach((k) => delete catalogBySourceId[k])
        Object.keys(tableMap).forEach((k) => delete tableMap[k])
        for (const t of lightCatalog || []) {
          if (t.sourceTableId) {
            catalogBySourceId[t.sourceTableId] = {
              id: t.id,
              sourceTableId: t.sourceTableId,
              tableName: t.tableName,
              schemaName: t.schemaName,
              displayName: t.displayName,
              posX: t.posX,
              posY: t.posY,
            }
          }
        }

        // 仅拉取画布需要的表（有坐标或参与关系）+ 字段
        const neededIds = new Set()
        const rels = relationships || []
        for (const t of lightCatalog || []) {
          if (t.posX != null && t.posY != null && t.id != null) {
            neededIds.add(String(t.id))
          }
        }
        for (const r of rels) {
          if (r.sourceTableId != null) neededIds.add(String(r.sourceTableId))
          if (r.targetTableId != null) neededIds.add(String(r.targetTableId))
        }

        if (neededIds.size) {
          const { data: fullTables } = await getTablesWithColumnsByIds([...neededIds])
          for (const t of fullTables || []) {
            rememberCatalogTable(t)
          }
        }

        restoring = true
        const nodeIds = new Set(neededIds)
        let idx = 0
        const nodes = []
        for (const id of nodeIds) {
          const t = tableMap[id]
          if (!t) continue
          const light = catalogBySourceId[t.sourceTableId] || t
          const x = light.posX != null ? light.posX : t.posX != null ? t.posX : 220 + (idx % 4) * 220
          const y = light.posY != null ? light.posY : t.posY != null ? t.posY : 120 + Math.floor(idx / 4) * 140
          nodes.push(buildNode(t, x, y))
          idx++
        }
        const edges = rels.map((r) => {
          const props = {
            relationshipName: r.relationshipName || '',
            joinType: r.joinType || 'INNER',
            relationshipType: r.relationshipType || 'ONE_TO_MANY',
            description: r.description || '',
            fields: (r.fields || []).map((f) => ({
              sourceFieldId: f.sourceFieldId,
              targetFieldId: f.targetFieldId,
              operator: f.operator || '=',
              isPrimaryMapping: f.isPrimaryMapping ? 1 : 0,
            })),
          }
          return {
            id: String(r.id),
            type: 'polyline',
            sourceNodeId: String(r.sourceTableId),
            targetNodeId: String(r.targetTableId),
            text: edgeText(props),
            properties: props,
          }
        })
        lf.render({ nodes, edges })
        await nextTick()
        restoring = false
        lastSelectedIds = []
        selectedNodeIds.value = []
        syncCanvasTableIds()

        await loadRemoteTables()
      }

      /** 保存画布：节点坐标 + 关系 + 字段映射（全量覆盖） */
      const saveCanvas = async () => {
        const graph = lf.getGraphRawData()
        // 校验：所有边都必须有字段映射
        const invalid = graph.edges.filter(
          (e) =>
            !e.properties || !e.properties.fields || !e.properties.fields.length
        )
        if (invalid.length) {
          $baseMessage(
            '存在未配置字段映射的关系，请双击连线补充',
            'error',
            'vab-hey-message-error'
          )
          return
        }
        saving.value = true
        try {
          await saveRelationCanvas({
            dbConfigId,
            nodes: graph.nodes.map((n) => ({
              tableId: n.properties.tableId,
              posX: n.x,
              posY: n.y,
            })),
            relationships: graph.edges.map((e) => ({
              sourceTableId: e.sourceNodeId,
              targetTableId: e.targetNodeId,
              relationshipType: e.properties.relationshipType,
              joinType: e.properties.joinType,
              relationshipName: e.properties.relationshipName,
              description: e.properties.description,
              fields: e.properties.fields,
            })),
          })
          $baseMessage('画布保存成功', 'success', 'vab-hey-message-success')
        } finally {
          saving.value = false
        }
      }

      /** 寻路测试：对画布上选中的表调用后端寻路 */
      const testPath = async () => {
        const tableIds = [...selectedNodeIds.value]
        const { data } = await findBestRelationshipPath({
          dbConfigId,
          tableIds,
        })
        pathResult.value = data
        pathDialogVisible.value = true
      }

      const goBack = async () => {
        await backToListPage(route, router, {
          listRouteName: 'DbConfig',
          fallbackPath: '/visual/dbConfig',
        })
      }

      onMounted(async () => {
        if (!dbConfigId) {
          $baseMessage('缺少数据库配置ID', 'error', 'vab-hey-message-error')
          return
        }
        document.addEventListener('click', onGlobalClickCloseMenu)
        document.addEventListener('keydown', onGlobalKeyCloseMenu)
        document.addEventListener('keydown', onWindowKeydownDelete)
        initLogicFlow()
        await loadData()
        nextTick(() => canvasRef.value && canvasRef.value.focus())
      })

      onBeforeUnmount(() => {
        document.removeEventListener('click', onGlobalClickCloseMenu)
        document.removeEventListener('keydown', onGlobalKeyCloseMenu)
        document.removeEventListener('keydown', onWindowKeydownDelete)
        if (lf) {
          lf.destroy()
          lf = null
        }
      })

      return {
        ArrowLeft,
        Search,
        LIST_ITEM_HEIGHT,
        dbConfigName,
        canvasRef,
        catalogScrollRef,
        saving,
        tableFilter,
        remoteLoading,
        syncingTableName,
        schemaOptions,
        currentSchema,
        filteredRemoteTables,
        visibleRemoteTables,
        virtualOffset,
        selectedNodeIds,
        multiSelectMode,
        pathDialogVisible,
        pathResult,
        edgeDialogVisible,
        edgeForm,
        joinOperators,
        ctxMenu,
        ctxMenuOnCanvas,
        tableLabel,
        fieldsOfTable,
        fieldLabel,
        isTableSynced,
        isTableOnCanvas,
        onCatalogScroll,
        handleSchemaChange,
        loadRemoteTables,
        addRemoteTableToCanvas,
        openCatalogContextMenu,
        ctxMenuAdd,
        ctxMenuRemove,
        onCanvasKeydown,
        addMapping,
        removeMapping,
        confirmEdge,
        cancelEdgeDialog,
        deleteEdge,
        saveCanvas,
        testPath,
        toggleMultiSelectMode,
        goBack,
      }
    },
  })
</script>

<template>
  <div class="relation-canvas-container">
    <!-- 顶部工具栏 -->
    <div class="canvas-toolbar">
      <div class="toolbar-left">
        <el-button :icon="ArrowLeft" @click="goBack">返回</el-button>
        <span class="db-title">{{ dbConfigName }} - 关系画布（一张网）</span>
      </div>
      <div class="toolbar-right">
        <el-tooltip
          content="开启后点击表可叠加选中；也可按住 Shift / Ctrl 点选"
          placement="bottom"
        >
          <el-button
            :type="multiSelectMode ? 'warning' : 'default'"
            @click="toggleMultiSelectMode"
          >
            {{ multiSelectMode ? '退出多选' : '多选模式' }}
          </el-button>
        </el-tooltip>
        <el-tooltip
          content="请先多选至少 2 张表：开启「多选模式」后点击，或按住 Shift/Ctrl 点击"
          placement="bottom"
        >
          <el-button :disabled="selectedNodeIds.length < 2" @click="testPath">
            寻路测试（已选 {{ selectedNodeIds.length }} 表）
          </el-button>
        </el-tooltip>
        <el-button type="primary" :loading="saving" @click="saveCanvas">
          保存画布
        </el-button>
      </div>
    </div>

    <div class="canvas-body">
      <!-- 左侧：远端库表列表（轻量，按需同步入库） -->
      <div class="table-catalog">
        <div class="catalog-header">
          <el-select
            v-model="currentSchema"
            placeholder="选择数据库"
            size="small"
            filterable
            style="width: 100%; margin-bottom: 8px"
            @change="handleSchemaChange"
          >
            <el-option
              v-for="item in schemaOptions"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
          <el-input
            v-model="tableFilter"
            clearable
            placeholder="搜索表名（推荐）"
            size="small"
            :prefix-icon="Search"
          />
          <div class="catalog-meta">
            <span>共 {{ filteredRemoteTables.length }} 张表</span>
            <el-button link type="primary" size="small" :loading="remoteLoading" @click="loadRemoteTables">
              刷新
            </el-button>
          </div>
        </div>
        <div
          ref="catalogScrollRef"
          class="catalog-list"
          v-loading="remoteLoading"
          @scroll="onCatalogScroll"
        >
          <div
            class="catalog-phantom"
            :style="{ height: `${filteredRemoteTables.length * LIST_ITEM_HEIGHT }px` }"
          >
            <div
              class="catalog-window"
              :style="{ transform: `translateY(${virtualOffset}px)` }"
            >
              <div
                v-for="table in visibleRemoteTables"
                :key="table.tableName"
                class="catalog-item"
                :class="{
                  'on-canvas': isTableOnCanvas(table),
                  'is-syncing': syncingTableName === table.tableName,
                }"
                @click="addRemoteTableToCanvas(table)"
                @contextmenu.prevent="openCatalogContextMenu($event, table)"
              >
                <div class="catalog-item-name">
                  {{ table.displayName || table.tableName }}
                </div>
                <div class="catalog-item-code">{{ table.tableName }}</div>
                <div class="catalog-item-tags">
                  <el-tag v-if="isTableSynced(table)" size="small" type="info">已入库</el-tag>
                  <el-tag v-if="isTableOnCanvas(table)" size="small" type="success">已在画布</el-tag>
                  <el-tag v-if="syncingTableName === table.tableName" size="small" type="warning">同步中</el-tag>
                </div>
              </div>
            </div>
          </div>
          <el-empty
            v-if="!remoteLoading && !filteredRemoteTables.length"
            description="未找到表，请切换数据库或调整搜索"
            :image-size="80"
          />
        </div>
        <div class="catalog-tip">
          左键点击或右键「添加」加入画布；右键「删除」或选中节点后按 Delete 可移除（需保存画布才持久化）。
        </div>
      </div>

      <!-- 画布 -->
      <div ref="canvasRef" class="lf-canvas" tabindex="0" @keydown="onCanvasKeydown"></div>
    </div>

    <!-- 左侧表右键菜单 -->
    <Teleport to="body">
      <div
        v-show="ctxMenu.visible"
        class="vq-ctx-menu"
        :style="{ left: `${ctxMenu.x }px`, top: `${ctxMenu.y }px` }"
        @click.stop
      >
        <div
          class="vq-ctx-item"
          :class="{ disabled: ctxMenuOnCanvas }"
          @click="!ctxMenuOnCanvas && ctxMenuAdd()"
        >
          添加到画布
        </div>
        <div
          class="vq-ctx-item danger"
          :class="{ disabled: !ctxMenuOnCanvas }"
          @click="ctxMenuOnCanvas && ctxMenuRemove()"
        >
          从画布删除
        </div>
      </div>
    </Teleport>

    <!-- 关系编辑弹窗 -->
    <el-dialog
      v-model="edgeDialogVisible"
      title="编辑表关系"
      width="900px"
      :close-on-click-modal="false"
    >
      <div class="edge-tables-tip">
        <el-tag>{{ tableLabel(edgeForm.sourceTableId) }}</el-tag>
        <span class="arrow">→</span>
        <el-tag type="warning">{{ tableLabel(edgeForm.targetTableId) }}</el-tag>
      </div>
      <el-form label-width="90px" class="edge-form">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="关系名称">
              <el-input
                v-model="edgeForm.relationshipName"
                placeholder="可选，如：订单-用户"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="JOIN">
              <el-select v-model="edgeForm.joinType">
                <el-option label="INNER" value="INNER" />
                <el-option label="LEFT" value="LEFT" />
                <el-option label="RIGHT" value="RIGHT" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="关系类型">
              <el-select v-model="edgeForm.relationshipType">
                <el-option label="一对一" value="ONE_TO_ONE" />
                <el-option label="一对多" value="ONE_TO_MANY" />
                <el-option label="多对一" value="MANY_TO_ONE" />
                <el-option label="多对多" value="MANY_TO_MANY" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">
          字段映射（多组之间 AND 连接）
        </el-divider>
        <div
          v-for="(mapping, idx) in edgeForm.fields"
          :key="idx"
          class="mapping-row"
        >
          <el-select
            v-model="mapping.sourceFieldId"
            filterable
            placeholder="源表字段"
            class="mapping-field"
          >
            <el-option
              v-for="f in fieldsOfTable(edgeForm.sourceTableId)"
              :key="f.id"
              :label="fieldLabel(f)"
              :value="f.id"
            />
          </el-select>
          <el-select v-model="mapping.operator" class="mapping-op">
            <el-option
              v-for="op in joinOperators"
              :key="op"
              :label="op"
              :value="op"
            />
          </el-select>
          <el-select
            v-model="mapping.targetFieldId"
            filterable
            placeholder="目标表字段"
            class="mapping-field"
          >
            <el-option
              v-for="f in fieldsOfTable(edgeForm.targetTableId)"
              :key="f.id"
              :label="fieldLabel(f)"
              :value="f.id"
            />
          </el-select>
          <el-checkbox v-model="mapping.isPrimaryMapping" label="主映射" />
          <el-button
            type="danger"
            link
            :disabled="edgeForm.fields.length <= 1"
            @click="removeMapping(idx)"
          >
            删除
          </el-button>
        </div>
        <el-button link type="primary" @click="addMapping">
          + 添加字段映射
        </el-button>

        <el-form-item label="描述" style="margin-top: 12px">
          <el-input
            v-model="edgeForm.description"
            type="textarea"
            :rows="2"
            placeholder="可选"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="danger" plain @click="deleteEdge">
          删除该关系
        </el-button>
        <el-button @click="cancelEdgeDialog">取消</el-button>
        <el-button type="primary" @click="confirmEdge">确定</el-button>
      </template>
    </el-dialog>

    <!-- 寻路测试结果 -->
    <el-dialog v-model="pathDialogVisible" title="自动寻路结果" width="640px">
      <template v-if="pathResult">
        <el-alert
          :type="pathResult.connected ? 'success' : 'error'"
          :title="
            pathResult.connected
              ? '所选表连通，JOIN 顺序如下'
              : pathResult.message || '所选表不连通'
          "
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
        />
        <template v-if="pathResult.connected">
          <div
            v-if="
              pathResult.intermediateTableIds &&
              pathResult.intermediateTableIds.length
            "
            style="margin-bottom: 8px"
          >
            自动引入中间表：
            <el-tag
              v-for="tid in pathResult.intermediateTableIds"
              :key="tid"
              type="warning"
              style="margin-right: 6px"
            >
              {{ tableLabel(tid) }}
            </el-tag>
          </div>
          <el-timeline>
            <el-timeline-item
              v-for="(rel, i) in pathResult.relationships"
              :key="rel.id"
              :timestamp="`第 ${i + 1} 步`"
            >
              {{ tableLabel(rel.sourceTableId) }}
              <el-tag size="small" style="margin: 0 4px">
                {{ rel.joinType || 'INNER' }} JOIN
              </el-tag>
              {{ tableLabel(rel.targetTableId) }}
            </el-timeline-item>
          </el-timeline>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
  .relation-canvas-container {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 120px);
    padding: 12px;

    .canvas-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      margin-bottom: 8px;
      background: #fff;
      border-radius: 6px;
      box-shadow: 0 1px 4px rgb(0 0 0 / 8%);

      .db-title {
        margin-left: 12px;
        font-size: 15px;
        font-weight: 600;
      }
    }

    .canvas-body {
      display: flex;
      flex: 1;
      gap: 8px;
      min-height: 0;

      .table-catalog {
        display: flex;
        flex-direction: column;
        width: 280px;
        overflow: hidden;
        background: #fff;
        border-radius: 6px;
        box-shadow: 0 1px 4px rgb(0 0 0 / 8%);

        .catalog-header {
          padding: 8px;
          border-bottom: 1px solid #ebeef5;

          .catalog-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 6px;
            font-size: 12px;
            color: #909399;
          }
        }

        .catalog-list {
          position: relative;
          flex: 1;
          min-height: 0;
          overflow: auto;

          .catalog-phantom {
            position: relative;
            width: 100%;
          }

          .catalog-window {
            position: absolute;
            top: 0;
            right: 0;
            left: 0;
          }
        }

        .catalog-item {
          box-sizing: border-box;
          height: 72px;
          padding: 8px 10px;
          margin: 0;
          cursor: pointer;
          border-bottom: 1px solid #f0f2f5;
          transition: all 0.15s;

          &:hover {
            background: #ecf5ff;
          }

          &.on-canvas {
            background: #f0f9eb;
          }

          &.is-syncing {
            pointer-events: none;
            opacity: 0.65;
          }

          .catalog-item-name {
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 13px;
            font-weight: 600;
            color: #303133;
            white-space: nowrap;
          }

          .catalog-item-code {
            margin-top: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 12px;
            color: #909399;
            white-space: nowrap;
          }

          .catalog-item-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
          }
        }

        .catalog-tip {
          padding: 8px;
          font-size: 11px;
          line-height: 1.4;
          color: #909399;
          background: #fafafa;
          border-top: 1px solid #ebeef5;
        }
      }

      .lf-canvas {
        flex: 1;
        min-width: 0;
        outline: none;
        background: #fff;
        border-radius: 6px;
        box-shadow: 0 1px 4px rgb(0 0 0 / 8%);

        &:focus {
          outline: none;
        }
      }
    }
  }

  .edge-tables-tip {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 14px;

    .arrow {
      font-weight: bold;
      color: #909399;
    }
  }

  .mapping-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;

    .mapping-field {
      flex: 1;
    }

    .mapping-op {
      width: 80px;
    }
  }
</style>

<style lang="scss">
  /* Teleport 到 body，需非 scoped */
  .vq-ctx-menu {
    position: fixed;
    z-index: 4000;
    min-width: 140px;
    padding: 4px 0;
    user-select: none;
    background: #fff;
    border: 1px solid #e4e7ed;
    border-radius: 6px;
    box-shadow: 0 6px 16px rgb(0 0 0 / 12%);

    .vq-ctx-item {
      padding: 8px 14px;
      font-size: 13px;
      line-height: 1.4;
      color: #303133;
      cursor: pointer;

      &:hover:not(.disabled) {
        color: #409eff;
        background: #ecf5ff;
      }

      &.danger:hover:not(.disabled) {
        color: #f56c6c;
        background: #fef0f0;
      }

      &.disabled {
        color: #c0c4cc;
        cursor: not-allowed;
      }
    }
  }
</style>
