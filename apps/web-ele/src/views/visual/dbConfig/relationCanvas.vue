<script setup lang="ts">
  /**
   * 关系画布（AntV X6）
   * - 左侧：远端表目录（按 schema），点击同步并加入画布
   * - 画布：表节点 + 关系边（字段映射）；保存协议兼容 loadCanvas/saveCanvas
   * - 交互：空白平移 / 拖节点 / 仅边缘端口连线 / 多选寻路 / 表目录可收起 / 可展开全部字段
   */
  import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    watch,
  } from 'vue'
  import { useRoute, useRouter } from 'vue-router'

  import { Graph, Shape } from '@antv/x6'
  import { History } from '@antv/x6-plugin-history'
  import { Keyboard } from '@antv/x6-plugin-keyboard'
  import { Selection } from '@antv/x6-plugin-selection'
  import { Snapline } from '@antv/x6-plugin-snapline'
  import { Page } from '@vben/common-ui'
  import { usePreferences } from '@vben/preferences'
  import { ArrowLeft, Expand, Fold, Search } from '@element-plus/icons-vue'
  import { ElMessage } from 'element-plus'

  import '@antv/x6-plugin-selection/es/index.css'

  import { getInstances, getTables } from '#/api/visual/database'
  import {
    addRelationCanvasGroup,
    editRelationCanvasGroup,
    findBestRelationshipPath,
    getCatalogTablesLight,
    getDbConfigById,
    getTablesWithColumnsByIds,
    listRelationCanvasGroups,
    loadRelationCanvas,
    saveRelationCanvas,
    syncTableToCatalog,
    updateTableDisplayName,
  } from '#/api/visual/vq'
  import { backToListPage } from '#/utils/route-back'

  const NODE_SHAPE = 'table-node'
  /** 紧凑卡片：只显示表名和字段数 */
  const COMPACT_WIDTH = 188
  const COMPACT_HEIGHT = 80
  /** 字段展开卡片宽度；高度随字段行数变化 */
  const FIELD_NODE_WIDTH = 280
  const FIELD_ROW_H = 22
  const FIELD_BOTTOM_PAD = 6
  const LIST_ITEM_HEIGHT = 72
  const VIRTUAL_BUFFER = 8
  const SHOW_FIELDS_KEY = 'vq-relation-canvas-show-fields'
  const CATALOG_COLLAPSE_KEY = 'vq-relation-canvas-catalog-collapsed'

  interface EdgeFieldMapping {
    sourceFieldId: string | number | null
    targetFieldId: string | number | null
    operator: string
    isPrimaryMapping: boolean | number
  }

  interface EdgeRelationData {
    relationshipName?: string
    joinType?: string
    relationshipType?: string
    description?: string
    fields?: EdgeFieldMapping[]
  }

  interface TableNodeData {
    tableId: string | number
    tableName: string
    displayName?: string
    schemaName?: string
    fieldCount: number
  }

  /** 不同实例表头配色（按实例列表下标循环） */
  const INSTANCE_HEADER_COLORS = [
    '#5a78a0',
    '#409eff',
    '#67c23a',
    '#e6a23c',
    '#f56c6c',
    '#9b59b6',
    '#1abc9c',
    '#e67e22',
    '#3498db',
    '#16a085',
  ]

  const { isDark } = usePreferences()

  function headerColorForSchema(schema?: string | null) {
    const name = String(schema || '').trim()
    if (!name) return canvasTheme().headerFill
    const idx = instanceOptions.value.indexOf(name)
    if (idx >= 0) {
      return INSTANCE_HEADER_COLORS[idx % INSTANCE_HEADER_COLORS.length]
    }
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
    return INSTANCE_HEADER_COLORS[Math.abs(h) % INSTANCE_HEADER_COLORS.length]
  }

  /** 画布/节点主题色，跟随系统亮暗色 */
  function canvasTheme() {
    const dark = isDark.value
    return {
      bodyFill: dark ? '#1d1e1f' : '#ffffff',
      bodyStroke: dark ? '#5a7aa0' : '#5a78a0',
      headerFill: dark ? '#3d5a80' : '#5a78a0',
      headerFillActive: '#409eff',
      titleFill: '#ffffff',
      nameFill: dark ? '#cfd3dc' : '#303133',
      metaFill: dark ? '#a3a6ad' : '#909399',
      edgeStroke: dark ? '#7a9cc0' : '#5a78a0',
      grid: dark ? '#333843' : '#dfe3e8',
      bg: dark ? '#141414' : '#f0f2f5',
      rowAlt: dark ? '#26282e' : '#f6f8fb',
      pkFill: dark ? '#e6a23c' : '#b88230',
      headerSubFill: 'rgba(255,255,255,0.78)',
    }
  }

  /**
   * 端口样式：只有端口是 magnet，节点本体不可拉线。
   */
  const portAttrs = {
    circle: {
      r: 5,
      magnet: true,
      stroke: '#5F95FF',
      strokeWidth: 1.5,
      fill: '#fff',
    },
  }

  const defaultPorts = {
    groups: {
      top: { position: 'top', attrs: portAttrs },
      right: { position: 'right', attrs: portAttrs },
      bottom: { position: 'bottom', attrs: portAttrs },
      left: { position: 'left', attrs: portAttrs },
    },
    items: [
      { id: 'port-top', group: 'top' },
      { id: 'port-right', group: 'right' },
      { id: 'port-bottom', group: 'bottom' },
      { id: 'port-left', group: 'left' },
    ],
  }

  /**
   * 默认节点与紧凑卡片一致。新建节点时 attrs 会与注册表深合并，
   * 若这里仍留着 refX:50% 居中，会和 buildNodeMeta 的绝对 x 叠在一起，文字跑出框外。
   */
  function registerShapes() {
    const t = canvasTheme()
    const headerH = 28
    Graph.registerNode(
      NODE_SHAPE,
      {
        width: COMPACT_WIDTH,
        height: COMPACT_HEIGHT,
        markup: [
          { tagName: 'rect', selector: 'body' },
          { tagName: 'rect', selector: 'header' },
          { tagName: 'rect', selector: 'headerBottom' },
          { tagName: 'text', selector: 'headerLabel' },
          { tagName: 'text', selector: 'nameLabel' },
          { tagName: 'text', selector: 'metaLabel' },
        ],
        attrs: {
          body: {
            refWidth: '100%',
            refHeight: '100%',
            stroke: t.bodyStroke,
            strokeWidth: 1.25,
            fill: t.bodyFill,
            rx: 8,
            ry: 8,
            magnet: false,
          },
          header: {
            x: 1.25,
            y: 1.25,
            width: COMPACT_WIDTH - 2.5,
            height: headerH,
            fill: t.headerFill,
            strokeWidth: 0,
            rx: 7,
            ry: 7,
          },
          headerBottom: {
            x: 1.25,
            y: headerH - 7,
            width: COMPACT_WIDTH - 2.5,
            height: 7,
            fill: t.headerFill,
            strokeWidth: 0,
          },
          headerLabel: {
            x: 12,
            y: headerH / 2 + 1,
            textAnchor: 'start',
            textVerticalAnchor: 'middle',
            fontSize: 13,
            fontWeight: 600,
            fill: t.titleFill,
            text: '',
          },
          nameLabel: {
            x: 12,
            y: 48,
            textAnchor: 'start',
            textVerticalAnchor: 'middle',
            fontSize: 12,
            fill: t.nameFill,
            text: '',
          },
          metaLabel: {
            x: 12,
            y: 66,
            textAnchor: 'start',
            textVerticalAnchor: 'middle',
            fontSize: 11,
            fill: t.metaFill,
            text: '',
          },
        },
        ports: defaultPorts,
      },
      true,
    )
  }

  function applyThemeToGraph() {
    if (!graph) return
    const t = canvasTheme()
    graph.drawBackground({ color: t.bg })
    graph.drawGrid({
      type: 'dot',
      args: { color: t.grid, thickness: 1 },
    })
    graph.showGrid()
    // 字段行颜色跟主题走，整卡重绘；选中态在 buildNodeMeta 里读取
    refreshAllNodeVisuals()
    graph.getEdges().forEach((edge) => {
      edge.attr('line/stroke', t.edgeStroke)
      const props = (edge.getData() || {}) as EdgeRelationData
      applyEdgeLabel(edge, props)
    })
  }

  /**
   * 表头文案：有中文注释（displayName 且不同于表名）用注释，否则用表名。
   */
  function resolveHeaderLabel(table: {
    tableName?: string
    displayName?: string
    comment?: string
    tableComment?: string
  }) {
    const name = String(table.tableName || '').trim()
    const comment = String(
      table.displayName || table.comment || table.tableComment || '',
    ).trim()
    if (comment && comment !== name) return comment
    return name
  }

  function truncateLabel(text: string, max = 14) {
    const s = String(text || '')
    return s.length > max ? `${s.slice(0, max)}…` : s
  }

  function edgeLabelText(props: EdgeRelationData) {
    const n = props.fields ? props.fields.length : 0
    return `${props.joinType || 'LEFT'}${
      props.relationshipName ? ` · ${props.relationshipName}` : ''
    }（${n} 映射）`
  }

  function relTypeLabel(type?: string | null) {
    const map: Record<string, string> = {
      ONE_TO_ONE: '一对一',
      ONE_TO_MANY: '一对多',
      MANY_TO_ONE: '多对一',
      MANY_TO_MANY: '多对多',
    }
    const key = String(type || '')
    return map[key] || '未标注'
  }

  /** 主键标记：兼容目录接口里几种历史字段名 */
  function isPrimaryColumn(col: any) {
    return (
      col?.isPrimary === 1 ||
      col?.isPrimary === true ||
      col?.primaryKey === true ||
      col?.isPrimaryKey === true ||
      col?.pk === true ||
      col?.pk === 1
    )
  }

  function columnViews(table: any) {
    const cols = Array.isArray(table?.columns) ? table.columns : []
    return cols.map((col: any) => {
      const name = String(col.fieldName || col.columnName || '').trim()
      const commentRaw = String(
        col.displayName && col.displayName !== name
          ? col.displayName
          : col.description || col.columnComment || col.comment || '',
      ).trim()
      const comment = commentRaw && commentRaw !== name ? commentRaw : ''
      const typeText = String(col.dataType || col.columnType || '').trim()
      return {
        pk: isPrimaryColumn(col),
        typeText,
        label: comment ? `${name}  ${comment}` : name || '-',
      }
    })
  }

  function centerToTopLeft(
    cx: number,
    cy: number,
    width = COMPACT_WIDTH,
    height = COMPACT_HEIGHT,
  ) {
    return { x: cx - width / 2, y: cy - height / 2 }
  }

  function topLeftToCenter(
    x: number,
    y: number,
    width = COMPACT_WIDTH,
    height = COMPACT_HEIGHT,
  ) {
    return { posX: x + width / 2, posY: y + height / 2 }
  }

  const route = useRoute()
  const router = useRouter()

  const dbConfigId = route.query.id as string
  const dbConfigName = ref('')
  const canvasRef = ref<HTMLElement | null>(null)
  const catalogScrollRef = ref<HTMLElement | null>(null)
  const saving = ref(false)
  const switchingCanvas = ref(false)
  const tableFilter = ref('')
  const remoteLoading = ref(false)
  const syncingTableName = ref('')

  /**
   * 画布模型：同一 dbConfig 下每个实例（schema）对应唯一画布分组。
   * - canvasInstanceName：当前编辑的实例画布（工具栏切换）
   * - currentSchema：左侧表目录浏览的实例（可跨库拉表）
   */
  const canvasGroups = ref<any[]>([])
  const currentCanvasGroupId = ref<string | number | null>(null)
  const instanceOptions = ref<string[]>([])
  const canvasInstanceName = ref('')

  const schemaOptions = ref<string[]>([])
  const currentSchema = ref('')
  const remoteTables = ref<any[]>([])
  const catalogBySourceId = reactive<Record<string, any>>({})
  const tableMap = reactive<Record<string, any>>({})
  const canvasTableIds = ref<Set<string>>(new Set())

  const multiSelectMode = ref(false)
  /** 画布表卡片是否展开全部字段，偏好记在本地 */
  const showAllFields = ref(localStorage.getItem(SHOW_FIELDS_KEY) === '1')
  /** 左侧表目录是否收起 */
  const catalogCollapsed = ref(localStorage.getItem(CATALOG_COLLAPSE_KEY) === '1')
  const selectedNodeIds = ref<string[]>([])
  const pathDialogVisible = ref(false)
  const pathResult = ref<any>(null)

  /** 双击表节点：查看/改显示名 */
  const tableInfoVisible = ref(false)
  const tableInfoLoading = ref(false)
  const tableInfoSaving = ref(false)
  const tableInfo = reactive<{
    tableId: string
    tableName: string
    displayName: string
    schemaName: string
    syncRemoteComment: boolean
    columns: any[]
  }>({
    tableId: '',
    tableName: '',
    displayName: '',
    schemaName: '',
    syncRemoteComment: true,
    columns: [],
  })

  /** 左侧右键：仅改库注释的显示名 */
  const renameDialogVisible = ref(false)
  const renameSaving = ref(false)
  const renameForm = reactive<{
    tableName: string
    schemaName: string
    displayName: string
    tableId: string | number | null
  }>({
    tableName: '',
    schemaName: '',
    displayName: '',
    tableId: null,
  })

  const ctxMenu = reactive<{
    visible: boolean
    x: number
    y: number
    table: any | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    table: null,
  })

  const edgeDialogVisible = ref(false)
  let editingEdgeId: string | null = null
  let editingIsNew = false
  const edgeForm = reactive<{
    sourceTableId: string | number | null
    targetTableId: string | number | null
    relationshipName: string
    joinType: string
    relationshipType: string
    description: string
    fields: EdgeFieldMapping[]
  }>({
    sourceTableId: null,
    targetTableId: null,
    relationshipName: '',
    joinType: 'LEFT',
    relationshipType: 'ONE_TO_MANY',
    description: '',
    fields: [],
  })
  const joinOperators = ['=', '!=', '>', '<', '>=', '<=']

  let graph: Graph | null = null
  let selectionPlugin: Selection | null = null
  let restoring = false

  const virtualStart = ref(0)
  const virtualCount = ref(24)

  const buildSourceId = (tableName: string, schema = currentSchema.value) =>
    `${schema}-${dbConfigId}-${tableName}`

  const filteredRemoteTables = computed(() => {
    const kw = tableFilter.value.trim().toLowerCase()
    if (!kw) return remoteTables.value
    return remoteTables.value.filter(
      (t) =>
        (t.tableName || '').toLowerCase().includes(kw) ||
        (t.displayName || '').toLowerCase().includes(kw),
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
    const start = Math.max(
      0,
      Math.floor(el.scrollTop / LIST_ITEM_HEIGHT) - VIRTUAL_BUFFER,
    )
    const viewport =
      Math.ceil(el.clientHeight / LIST_ITEM_HEIGHT) + VIRTUAL_BUFFER * 2
    virtualStart.value = start
    virtualCount.value = Math.max(viewport, 20)
  }

  watch(tableFilter, async () => {
    virtualStart.value = 0
    await nextTick()
    if (catalogScrollRef.value) catalogScrollRef.value.scrollTop = 0
    onCatalogScroll()
  })

  const tableLabel = (tableId: string | number | null | undefined) => {
    const t = tableMap[String(tableId)]
    return t
      ? t.displayName || t.tableName
      : String(tableId == null ? '' : tableId)
  }

  const fieldsOfTable = (tableId: string | number | null | undefined) => {
    const t = tableMap[String(tableId)]
    return t && t.columns ? t.columns : []
  }

  const fieldLabel = (f: any) =>
    f.displayName && f.displayName !== f.fieldName
      ? `${f.fieldName}（${f.displayName}）`
      : f.fieldName

  const nodeExists = (tableId: string | number) => {
    if (!graph) return false
    return !!graph.getCellById(String(tableId))
  }

  const syncCanvasTableIds = () => {
    if (!graph) {
      canvasTableIds.value = new Set()
      return
    }
    canvasTableIds.value = new Set(graph.getNodes().map((n) => String(n.id)))
  }

  const syncSelectedNodeIds = () => {
    if (!selectionPlugin) {
      selectedNodeIds.value = []
      return
    }
    selectedNodeIds.value = selectionPlugin
      .getSelectedCells()
      .filter((c) => c.isNode())
      .map((c) => String(c.id))
    if (!graph) return
    const t = canvasTheme()
    const selected = new Set(selectedNodeIds.value)
    graph.getNodes().forEach((node) => {
      const data = (node.getData() || {}) as TableNodeData
      const on = selected.has(String(node.id))
      const headerFill = on
        ? t.headerFillActive
        : headerColorForSchema(data.schemaName)
      node.attr({
        header: { fill: headerFill },
        headerBottom: { fill: headerFill },
        body: {
          stroke: on ? t.headerFillActive : t.bodyStroke,
          strokeWidth: on ? 2 : 1.25,
        },
      })
    })
  }

  const isTableSynced = (table: any) => {
    const sid = buildSourceId(table.tableName)
    return !!catalogBySourceId[sid]
  }

  const isTableOnCanvas = (table: any) => {
    const sid = buildSourceId(table.tableName)
    const local = catalogBySourceId[sid]
    return !!(local && canvasTableIds.value.has(String(local.id)))
  }

  const ctxMenuOnCanvas = computed(() =>
    ctxMenu.table ? isTableOnCanvas(ctxMenu.table) : false,
  )

  const closeCatalogContextMenu = () => {
    ctxMenu.visible = false
    ctxMenu.table = null
  }

  const openCatalogContextMenu = (event: MouseEvent, table: any) => {
    ctxMenu.table = table
    const pad = 8
    const menuW = 140
    const menuH = 108
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

  const onGlobalKeyCloseMenu = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeCatalogContextMenu()
  }

  const rememberCatalogTable = (t: any) => {
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

  const applyEdgeLabel = (edge: any, props: EdgeRelationData) => {
    const t = canvasTheme()
    edge.setLabels([
      {
        attrs: {
          label: {
            text: edgeLabelText(props),
            fill: t.nameFill,
            fontSize: 11,
          },
          body: {
            fill: t.bodyFill,
            stroke: t.grid,
            strokeWidth: 1,
            rx: 4,
            ry: 4,
          },
        },
      },
    ])
  }

  /**
   * 表头用圆角矩形，再用一块同色矩形盖住底部圆角，
   * 这样只有卡片顶部是圆的，字段区和表头交界保持平直。
   */
  function headerMarkup() {
    return [
      { tagName: 'rect', selector: 'header' },
      { tagName: 'rect', selector: 'headerBottom' },
      { tagName: 'text', selector: 'headerLabel' },
    ]
  }

  function textAnchorStart(extra: Record<string, any> = {}) {
    return {
      // 显式清掉注册表里可能残留的相对定位，避免与绝对 x/y 叠加
      refX: null,
      refY: null,
      textAnchor: 'start',
      textVerticalAnchor: 'middle',
      ...extra,
    }
  }

  /**
   * 构建表节点。坐标入参为中心点（与旧 LogicFlow 存盘兼容）。
   * showAllFields 为真时按字段行撑开高度，否则保持紧凑卡片。
   */
  const buildNodeMeta = (table: any, x: number, y: number) => {
    const t = canvasTheme()
    const tableName = table.tableName || ''
    const schemaName = table.schemaName || ''
    const headerText = resolveHeaderLabel(table)
    const displayName = table.displayName || tableName
    const columns = columnViews(table)
    const fieldCount = columns.length
    const foreign =
      !!schemaName &&
      !!canvasInstanceName.value &&
      schemaName !== canvasInstanceName.value
    const selected = selectedNodeIds.value.includes(String(table.id))
    const headerFill = selected
      ? t.headerFillActive
      : headerColorForSchema(schemaName)
    const subText = foreign
      ? `${schemaName}.${tableName}`
      : tableName !== headerText
        ? tableName
        : ''

    if (!showAllFields.value) {
      const pos = centerToTopLeft(x, y, COMPACT_WIDTH, COMPACT_HEIGHT)
      const headerH = 28
      return {
        id: String(table.id),
        shape: NODE_SHAPE,
        x: pos.x,
        y: pos.y,
        width: COMPACT_WIDTH,
        height: COMPACT_HEIGHT,
        markup: [
          { tagName: 'rect', selector: 'body' },
          ...headerMarkup(),
          { tagName: 'text', selector: 'nameLabel' },
          { tagName: 'text', selector: 'metaLabel' },
        ],
        attrs: {
          body: {
            refWidth: '100%',
            refHeight: '100%',
            stroke: selected ? t.headerFillActive : t.bodyStroke,
            strokeWidth: selected ? 2 : 1.25,
            fill: t.bodyFill,
            rx: 8,
            ry: 8,
            magnet: false,
          },
          header: {
            x: 1.25,
            y: 1.25,
            width: COMPACT_WIDTH - 2.5,
            height: headerH,
            fill: headerFill,
            strokeWidth: 0,
            rx: 7,
            ry: 7,
          },
          headerBottom: {
            x: 1.25,
            y: headerH - 7,
            width: COMPACT_WIDTH - 2.5,
            height: 7,
            fill: headerFill,
            strokeWidth: 0,
          },
          headerLabel: textAnchorStart({
            x: 12,
            y: headerH / 2 + 1,
            fontSize: 13,
            fontWeight: 600,
            fill: t.titleFill,
            text: truncateLabel(headerText, 11),
          }),
          nameLabel: textAnchorStart({
            x: 12,
            y: 48,
            fontSize: 12,
            fill: t.nameFill,
            text: truncateLabel(tableName, 20),
          }),
          metaLabel: textAnchorStart({
            x: 12,
            y: 66,
            fontSize: 11,
            fill: t.metaFill,
            text: foreign
              ? `${truncateLabel(schemaName, 12)} · ${fieldCount} 字段`
              : `${fieldCount} 个字段`,
          }),
        },
        data: {
          tableId: table.id,
          tableName,
          displayName,
          schemaName,
          fieldCount,
        } as TableNodeData,
        ports: defaultPorts,
        zIndex: 2,
      }
    }

    const showSub = !!subText
    const headerH = showSub ? 40 : 30
    const rowCount = Math.max(fieldCount, 1)
    const height = headerH + rowCount * FIELD_ROW_H + FIELD_BOTTOM_PAD
    const width = FIELD_NODE_WIDTH
    const pos = centerToTopLeft(x, y, width, height)
    const markup: any[] = [
      { tagName: 'rect', selector: 'body' },
      ...headerMarkup(),
    ]
    if (showSub) markup.push({ tagName: 'text', selector: 'subLabel' })
    const attrs: Record<string, any> = {
      body: {
        refWidth: '100%',
        refHeight: '100%',
        stroke: selected ? t.headerFillActive : t.bodyStroke,
        strokeWidth: selected ? 2 : 1.25,
        fill: t.bodyFill,
        rx: 8,
        ry: 8,
        magnet: false,
      },
      header: {
        x: 1.25,
        y: 1.25,
        width: width - 2.5,
        height: headerH,
        fill: headerFill,
        strokeWidth: 0,
        rx: 7,
        ry: 7,
      },
      headerBottom: {
        x: 1.25,
        y: headerH - 7,
        width: width - 2.5,
        height: 7,
        fill: headerFill,
        strokeWidth: 0,
      },
      headerLabel: textAnchorStart({
        x: 12,
        y: showSub ? 14 : headerH / 2 + 1,
        fontSize: 13,
        fontWeight: 600,
        fill: t.titleFill,
        text: truncateLabel(headerText, 16),
      }),
    }
    if (showSub) {
      attrs.subLabel = textAnchorStart({
        x: 12,
        y: 30,
        fontSize: 10,
        fill: t.headerSubFill,
        text: truncateLabel(subText, 32),
      })
    }

    const rows =
      fieldCount > 0
        ? columns
        : [{ pk: false, typeText: '', label: '暂无字段' }]
    rows.forEach((col, i) => {
      const rowY = headerH + i * FIELD_ROW_H
      const midY = rowY + FIELD_ROW_H / 2
      markup.push(
        { tagName: 'rect', selector: `fRow${i}` },
        { tagName: 'rect', selector: `fMark${i}` },
        { tagName: 'text', selector: `fPk${i}` },
        { tagName: 'text', selector: `fName${i}` },
        { tagName: 'text', selector: `fType${i}` },
      )
      attrs[`fRow${i}`] = {
        x: 1.25,
        y: rowY,
        width: width - 2.5,
        height: FIELD_ROW_H,
        fill: i % 2 === 1 ? t.rowAlt : t.bodyFill,
        strokeWidth: 0,
        magnet: false,
      }
      attrs[`fMark${i}`] = {
        x: 1.25,
        y: rowY + 4,
        width: 3,
        height: FIELD_ROW_H - 8,
        rx: 1,
        fill: col.pk ? t.pkFill : 'none',
        strokeWidth: 0,
      }
      attrs[`fPk${i}`] = textAnchorStart({
        x: 10,
        y: midY,
        fontSize: 9,
        fontWeight: 700,
        fill: t.pkFill,
        text: col.pk ? 'PK' : '',
      })
      attrs[`fName${i}`] = textAnchorStart({
        x: col.pk ? 28 : 12,
        y: midY,
        fontSize: 11,
        fontWeight: col.pk ? 600 : 400,
        fill: t.nameFill,
        text: truncateLabel(col.label, col.pk ? 14 : 16),
      })
      attrs[`fType${i}`] = {
        refX: null,
        refY: null,
        x: width - 10,
        y: midY,
        textAnchor: 'end',
        textVerticalAnchor: 'middle',
        fontSize: 10,
        fill: t.metaFill,
        text: truncateLabel(col.typeText, 10),
      }
    })

    return {
      id: String(table.id),
      shape: NODE_SHAPE,
      x: pos.x,
      y: pos.y,
      width,
      height,
      markup,
      attrs,
      data: {
        tableId: table.id,
        tableName,
        displayName,
        schemaName,
        fieldCount,
      } as TableNodeData,
      ports: defaultPorts,
      zIndex: 2,
    }
  }

  /**
   * 按当前「显示全部字段」开关重绘单张表，中心点保持不变，避免切换后坐标漂移。
   */
  const refreshNodeVisual = (node: any) => {
    if (!node?.isNode?.()) return
    const pos = node.position()
    const size = node.size()
    const cx = pos.x + size.width / 2
    const cy = pos.y + size.height / 2
    const id = String(node.id)
    const data = (node.getData() || {}) as TableNodeData
    const cached = tableMap[id]
    const table = cached || {
      id,
      tableName: data.tableName,
      displayName: data.displayName,
      schemaName: data.schemaName,
      columns: [],
    }
    const meta = buildNodeMeta(table, cx, cy)
    node.setMarkup(meta.markup)
    node.resize(meta.width, meta.height)
    node.position(meta.x, meta.y)
    node.replaceAttrs(meta.attrs)
    node.setData(meta.data)
  }

  const refreshAllNodeVisuals = () => {
    if (!graph) return
    const history = graph.getPlugin('history') as History | undefined
    history?.disable()
    try {
      graph.getNodes().forEach((node) => refreshNodeVisual(node))
    } finally {
      history?.enable()
    }
  }

  /** 展开字段前补齐尚未拉过列信息的表 */
  const ensureCanvasColumns = async () => {
    if (!graph) return
    const missing = graph
      .getNodes()
      .map((n) => String(n.id))
      .filter((id) => {
        const t = tableMap[id]
        return !t?.columns?.length
      })
    if (!missing.length) return
    try {
      const { data } = await getTablesWithColumnsByIds(missing)
      for (const t of data || []) rememberCatalogTable(t)
    } catch (e) {
      console.warn('加载画布字段失败', e)
    }
  }

  const buildEdgeMeta = (r: any) => {
    const t = canvasTheme()
    const props: EdgeRelationData = {
      relationshipName: r.relationshipName || '',
      joinType: r.joinType || 'LEFT',
      relationshipType: r.relationshipType || 'ONE_TO_MANY',
      description: r.description || '',
      fields: (r.fields || []).map((f: any) => ({
        sourceFieldId: f.sourceFieldId,
        targetFieldId: f.targetFieldId,
        operator: f.operator || '=',
        isPrimaryMapping: f.isPrimaryMapping ? 1 : 0,
      })),
    }
    return {
      id: r.id != null ? String(r.id) : undefined,
      shape: 'edge',
      source: String(r.sourceTableId),
      target: String(r.targetTableId),
      data: props,
      attrs: {
        line: {
          stroke: t.edgeStroke,
          strokeWidth: 2,
          targetMarker: { name: 'block', width: 12, height: 8 },
        },
      },
      labels: [
        {
          attrs: {
            label: {
              text: edgeLabelText(props),
              fill: t.nameFill,
              fontSize: 11,
            },
            body: {
              fill: t.bodyFill,
              stroke: t.grid,
              strokeWidth: 1,
              rx: 4,
              ry: 4,
            },
          },
        },
      ],
      router: { name: 'manhattan' },
      connector: { name: 'rounded' },
      zIndex: 1,
    }
  }

  const removeNodeFromCanvas = (tableId: string | number) => {
    if (!graph || tableId == null) return false
    const id = String(tableId)
    const cell = graph.getCellById(id)
    if (!cell) return false
    graph.removeCell(id)
    selectedNodeIds.value = selectedNodeIds.value.filter((n) => n !== id)
    syncCanvasTableIds()
    return true
  }

  const deleteSelectedCells = () => {
    if (!graph || !selectionPlugin || edgeDialogVisible.value) return
    const cells = selectionPlugin.getSelectedCells()
    if (!cells.length) return
    const nodeCount = cells.filter((c) => c.isNode()).length
    graph.removeCells(cells)
    selectionPlugin.clean()
    selectedNodeIds.value = []
    syncCanvasTableIds()
    if (nodeCount) {
      ElMessage.success(`已从画布移除 ${nodeCount} 张表`)
    }
  }

  const openEdgeDialog = async (edgeId: string, isNew: boolean) => {
    if (!graph) return
    const edge = graph.getCellById(edgeId)
    if (!edge || !edge.isEdge()) return
    editingEdgeId = edgeId
    editingIsNew = isNew

    const sourceId = edge.getSourceCellId()
    const targetId = edge.getTargetCellId()
    const needLoad = [sourceId, targetId].filter((id) => {
      const t = tableMap[String(id)]
      return !t || !t.columns || !t.columns.length
    })
    if (needLoad.length) {
      try {
        const { data } = await getTablesWithColumnsByIds(needLoad.map(String))
        for (const t of data || []) rememberCatalogTable(t)
      } catch (e) {
        console.warn('加载表字段失败', e)
      }
    }

    const props = (edge.getData() || {}) as EdgeRelationData
    edgeForm.sourceTableId = sourceId
    edgeForm.targetTableId = targetId
    edgeForm.relationshipName = props.relationshipName || ''
    edgeForm.joinType = props.joinType || 'LEFT'
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

  const removeMapping = (idx: number) => {
    edgeForm.fields.splice(idx, 1)
  }

  const confirmEdge = () => {
    if (!graph || !editingEdgeId) return
    const valid = edgeForm.fields.filter(
      (f) => f.sourceFieldId && f.targetFieldId,
    )
    if (!valid.length) {
      ElMessage.warning('至少配置一组完整的字段映射')
      return
    }
    const props: EdgeRelationData = {
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
    const edge = graph.getCellById(editingEdgeId)
    if (edge && edge.isEdge()) {
      edge.setData(props)
      applyEdgeLabel(edge, props)
    }
    edgeDialogVisible.value = false
    editingEdgeId = null
  }

  const cancelEdgeDialog = () => {
    if (editingIsNew && editingEdgeId && graph) {
      graph.removeEdge(editingEdgeId)
    }
    edgeDialogVisible.value = false
    editingEdgeId = null
  }

  const deleteEdge = () => {
    if (editingEdgeId && graph) {
      graph.removeEdge(editingEdgeId)
    }
    edgeDialogVisible.value = false
    editingEdgeId = null
  }

  const applyMultiSelectModifiers = () => {
    if (!selectionPlugin) return
    const opts = (selectionPlugin as any).options
    // null = 单击即可叠加选中；否则需按住修饰键
    opts.multipleSelectionModifiers = multiSelectMode.value
      ? null
      : ['shift', 'ctrl', 'meta']
  }

  const toggleMultiSelectMode = () => {
    multiSelectMode.value = !multiSelectMode.value
    applyMultiSelectModifiers()
    ElMessage.info(
      multiSelectMode.value
        ? '已开启多选：点击表可叠加选中，再点一次取消选中'
        : '已退出多选模式',
    )
  }

  /**
   * 画布交互约定：
   * 1. 空白处按住左键拖拽 → 平移画布
   * 2. 拖拽节点主体 → 移动节点
   * 3. 仅从节点四边圆点（port）拖出 → 建立关系连线
   * 4. Shift + 空白拖拽 → 框选；Ctrl/Shift 点选 → 多选
   * 5. Ctrl + 滚轮 → 缩放
   */
  const initGraph = () => {
    if (!canvasRef.value) return
    registerShapes()
    const theme = canvasTheme()

    graph = new Graph({
      container: canvasRef.value,
      autoResize: true,
      background: { color: theme.bg },
      grid: {
        visible: true,
        type: 'dot',
        size: 16,
        args: { color: theme.grid, thickness: 1 },
      },
      // 空白左键平移；节点上的拖拽由 interacting.nodeMovable 处理，不会冲突
      panning: {
        enabled: true,
        eventTypes: ['leftMouseDown', 'mouseWheel'],
      },
      mousewheel: {
        enabled: true,
        modifiers: ['ctrl', 'meta'],
        factor: 1.1,
        maxScale: 2.5,
        minScale: 0.35,
      },
      interacting: {
        nodeMovable: true,
        edgeMovable: false,
        edgeLabelMovable: false,
        arrowheadMovable: false,
        vertexMovable: false,
        magnetConnectable: true,
      },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        // 禁止吸附到节点本体，只能连到 port
        allowNode: false,
        allowPort: true,
        allowEdge: false,
        allowMulti: true,
        highlight: true,
        snap: { radius: 24 },
        router: 'manhattan',
        connector: { name: 'rounded' },
        // 只有真正的 magnet（端口）才能开始连线
        validateMagnet({ magnet }) {
          return !!magnet && magnet.getAttribute('magnet') === 'true'
        },
        createEdge() {
          const t = canvasTheme()
          return new Shape.Edge({
            attrs: {
              line: {
                stroke: t.edgeStroke,
                strokeWidth: 2,
                targetMarker: { name: 'block', width: 12, height: 8 },
              },
            },
            router: { name: 'manhattan' },
            connector: { name: 'rounded' },
            data: {
              relationshipName: '',
              joinType: 'LEFT',
              relationshipType: 'ONE_TO_MANY',
              description: '',
              fields: [],
            } as EdgeRelationData,
            zIndex: 1,
          })
        },
        validateConnection({ sourceCell, targetCell, sourceMagnet, targetMagnet }) {
          if (!sourceCell || !targetCell) return false
          if (sourceCell.id === targetCell.id) return false
          if (!sourceMagnet || !targetMagnet) return false
          return sourceCell.isNode() && targetCell.isNode()
        },
      },
      highlighting: {
        magnetAdsorbed: {
          name: 'stroke',
          args: { attrs: { fill: '#fff', stroke: '#409eff', strokeWidth: 3 } },
        },
      },
    })

    selectionPlugin = new Selection({
      enabled: true,
      multiple: true,
      rubberband: true,
      movable: true,
      showNodeSelectionBox: true,
      showEdgeSelectionBox: true,
      pointerEvents: 'none',
      // Shift 框选，避免与空白处左键平移冲突
      modifiers: ['shift'],
      multipleSelectionModifiers: ['shift', 'ctrl', 'meta'],
    })
    graph.use(selectionPlugin)
    graph.use(new Snapline({ enabled: true }))
    graph.use(new Keyboard({ enabled: true }))
    graph.use(new History({ enabled: true }))
    applyMultiSelectModifiers()

    graph.bindKey(['delete', 'backspace'], () => {
      if (edgeDialogVisible.value || pathDialogVisible.value || tableInfoVisible.value)
        return false
      deleteSelectedCells()
      return false
    })

    graph.on('edge:connected', ({ edge, isNew }: any) => {
      if (restoring) return
      if (!isNew) return
      const sourceId = edge.getSourceCellId()
      const targetId = edge.getTargetCellId()
      if (!sourceId || !targetId || sourceId === targetId) {
        graph?.removeEdge(edge.id)
        ElMessage.warning('不能创建自关联关系')
        return
      }
      applyEdgeLabel(edge, (edge.getData() || {}) as EdgeRelationData)
      openEdgeDialog(String(edge.id), true)
    })

    graph.on('edge:dblclick', ({ edge }: any) => {
      openEdgeDialog(String(edge.id), false)
    })

    graph.on('node:dblclick', ({ node }: any) => {
      openTableInfoDialog(node)
    })

    graph.on('selection:changed', () => {
      syncSelectedNodeIds()
    })

    graph.on('node:removed', () => {
      syncCanvasTableIds()
      syncSelectedNodeIds()
    })

    graph.on('blank:click', () => {
      nextTick(() => canvasRef.value?.focus())
    })

    graph.on('node:click', () => {
      nextTick(() => canvasRef.value?.focus())
    })
  }

  const openTableInfoDialog = async (node: any) => {
    const data = (node.getData() || {}) as TableNodeData
    const tableId = String(data.tableId || node.id)
    tableInfo.tableId = tableId
    tableInfo.tableName = data.tableName || ''
    tableInfo.displayName = data.displayName || data.tableName || ''
    tableInfo.schemaName = data.schemaName || ''
    tableInfo.syncRemoteComment = true
    tableInfo.columns = []
    tableInfoVisible.value = true
    tableInfoLoading.value = true
    try {
      let table = tableMap[tableId]
      if (!table?.columns?.length) {
        const { data: list } = await getTablesWithColumnsByIds([tableId])
        const row = Array.isArray(list) ? list[0] : list
        if (row) {
          rememberCatalogTable(row)
          table = row
        }
      }
      if (table) {
        tableInfo.tableName = table.tableName || tableInfo.tableName
        tableInfo.displayName =
          table.displayName || table.tableName || tableInfo.displayName
        tableInfo.schemaName =
          table.schemaName || data.schemaName || currentSchema.value || ''
        tableInfo.columns = table.columns || []
      }
    } catch (e: any) {
      console.error(e)
      ElMessage.error(e?.msg || e?.message || '加载表信息失败')
    } finally {
      tableInfoLoading.value = false
    }
  }

  /** 将新显示名写回画布节点与本地缓存 */
  const applyDisplayNameToNode = (
    tableId: string | number,
    displayName: string,
    schemaName?: string,
  ) => {
    const id = String(tableId)
    const cached = tableMap[id]
    if (cached) {
      cached.displayName = displayName
      if (schemaName) cached.schemaName = schemaName
    }
    const sid = Object.keys(catalogBySourceId).find(
      (k) => String(catalogBySourceId[k]?.id) === id,
    )
    if (sid && catalogBySourceId[sid]) {
      catalogBySourceId[sid].displayName = displayName
    }
    if (!graph) return
    const node = graph.getCellById(id)
    if (!node || !node.isNode()) return
    refreshNodeVisual(node)
  }

  const saveTableDisplayNameFromInfo = async () => {
    const name = String(tableInfo.displayName || '').trim()
    if (!name) {
      ElMessage.warning('请输入显示名称')
      return
    }
    tableInfoSaving.value = true
    try {
      const { data } = await updateTableDisplayName({
        tableId: tableInfo.tableId,
        dbConfigId,
        schemaName: tableInfo.schemaName,
        tableName: tableInfo.tableName,
        displayName: name,
        syncRemoteComment: tableInfo.syncRemoteComment,
      })
      if (data) rememberCatalogTable(data)
      applyDisplayNameToNode(
        tableInfo.tableId,
        name,
        tableInfo.schemaName || undefined,
      )
      // 左侧列表若同源表也刷新展示
      const remote = remoteTables.value.find(
        (t) => t.tableName === tableInfo.tableName,
      )
      if (remote && currentSchema.value === tableInfo.schemaName) {
        remote.displayName = name
      }
      ElMessage.success(
        tableInfo.syncRemoteComment
          ? '显示名称已更新，并已同步数据库注释'
          : '显示名称已更新（仅本画布目录）',
      )
    } catch (e: any) {
      console.error(e)
      ElMessage.error(e?.msg || e?.message || '保存显示名称失败')
    } finally {
      tableInfoSaving.value = false
    }
  }

  const openRenameDialog = () => {
    const table = ctxMenu.table
    closeCatalogContextMenu()
    if (!table) return
    const sid = buildSourceId(table.tableName)
    const local = catalogBySourceId[sid]
    renameForm.tableName = table.tableName || ''
    renameForm.schemaName = currentSchema.value || ''
    renameForm.displayName =
      table.displayName || local?.displayName || table.tableName || ''
    renameForm.tableId = local?.id ?? null
    renameDialogVisible.value = true
  }

  const confirmRenameFromCatalog = async () => {
    const name = String(renameForm.displayName || '').trim()
    if (!name) {
      ElMessage.warning('请输入显示名称')
      return
    }
    if (!renameForm.tableName || !renameForm.schemaName) {
      ElMessage.warning('缺少表信息')
      return
    }
    renameSaving.value = true
    try {
      const { data } = await updateTableDisplayName({
        tableId: renameForm.tableId,
        dbConfigId,
        schemaName: renameForm.schemaName,
        tableName: renameForm.tableName,
        displayName: name,
        syncRemoteComment: true,
      })
      if (data) {
        rememberCatalogTable(data)
        if (data.id != null) {
          applyDisplayNameToNode(data.id, name, renameForm.schemaName)
        }
      }
      const remote = remoteTables.value.find(
        (t) => t.tableName === renameForm.tableName,
      )
      if (remote) remote.displayName = name
      renameDialogVisible.value = false
      ElMessage.success('已修改数据库表注释')
    } catch (e: any) {
      console.error(e)
      ElMessage.error(e?.msg || e?.message || '修改显示名称失败')
    } finally {
      renameSaving.value = false
    }
  }

  const addRemoteTableToCanvas = async (remoteTable: any) => {
    if (!graph) return
    if (!currentSchema.value) {
      ElMessage.warning('请先选择数据库')
      return
    }
    const sourceId = buildSourceId(remoteTable.tableName)
    let local = catalogBySourceId[sourceId]
      ? tableMap[String(catalogBySourceId[sourceId].id)]
      : null

    if (local && nodeExists(local.id)) {
      ElMessage.info('该表已在画布上')
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
        ElMessage.error('同步表失败')
        return
      }
      if (nodeExists(local.id)) {
        ElMessage.info('该表已在画布上')
        return
      }
      const count = graph.getNodes().length
      const stepX = showAllFields.value ? 320 : 230
      const stepY = showAllFields.value ? 200 : 150
      const cx = 240 + (count % 4) * stepX
      const cy = 160 + Math.floor(count / 4) * stepY
      // 先按注册表创建，再整卡重绘，避免 attrs 深合并把文字挤出框外
      const node = graph.addNode(buildNodeMeta(local, cx, cy))
      refreshNodeVisual(node)
      syncCanvasTableIds()
    } catch (e: any) {
      console.error(e)
      ElMessage.error(e?.msg || e?.message || '同步并加入画布失败')
    } finally {
      syncingTableName.value = ''
    }
  }

  const ctxMenuAdd = async () => {
    const table = ctxMenu.table
    closeCatalogContextMenu()
    if (!table) return
    if (isTableOnCanvas(table)) {
      ElMessage.info('该表已在画布上')
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
      ElMessage.info('该表不在画布上')
      return
    }
    if (removeNodeFromCanvas(local.id)) {
      ElMessage.success(
        `已从画布移除 ${table.displayName || table.tableName}`,
      )
    }
  }

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
      ElMessage.error('加载远端表列表失败')
    } finally {
      remoteLoading.value = false
    }
  }

  const handleSchemaChange = async () => {
    tableFilter.value = ''
    await loadRemoteTables()
  }

  /**
   * 确保每个实例都有同名画布分组；历史「默认画布」在仅有一个时迁移为默认实例名。
   */
  const ensureInstanceCanvasGroups = async (preferredInstance?: string) => {
    const { data } = await listRelationCanvasGroups(dbConfigId)
    canvasGroups.value = data || []

    const migrateTarget =
      (preferredInstance && instanceOptions.value.includes(preferredInstance)
        ? preferredInstance
        : null) || instanceOptions.value[0] || ''

    if (
      canvasGroups.value.length === 1 &&
      canvasGroups.value[0].groupName === '默认画布' &&
      migrateTarget
    ) {
      try {
        const row = { ...canvasGroups.value[0], groupName: migrateTarget }
        await editRelationCanvasGroup(row)
        canvasGroups.value[0].groupName = migrateTarget
      } catch (e) {
        console.warn('迁移默认画布失败', e)
      }
    }

    const existing = new Set(
      canvasGroups.value.map((g) => String(g.groupName || '')),
    )
    for (let i = 0; i < instanceOptions.value.length; i++) {
      const inst = instanceOptions.value[i]
      if (!inst || existing.has(inst)) continue
      try {
        const { data: created } = await addRelationCanvasGroup({
          dbConfigId,
          groupName: inst,
          isPublic: 1,
          orderNum: i,
        })
        if (created) {
          canvasGroups.value.push(created)
          existing.add(inst)
        }
      } catch (e) {
        console.warn(`创建实例画布失败: ${inst}`, e)
      }
    }
  }

  const syncCanvasGroupByInstance = () => {
    const g = canvasGroups.value.find(
      (x) => String(x.groupName) === String(canvasInstanceName.value),
    )
    currentCanvasGroupId.value = g?.id ?? null
  }

  /** 加载实例列表，并为每个实例准备画布分组 */
  const resolveInstancesAndCanvas = async (config?: any) => {
    const { data: instanceTree } = await getInstances(dbConfigId)
    const instances = instanceTree?.[0]?.instances || []
    instanceOptions.value = instances
      .map((i: any) => i.instanceName)
      .filter(Boolean)
    schemaOptions.value = [...instanceOptions.value]

    const preferred =
      (route.query.instance as string) ||
      config?.schemaName ||
      canvasInstanceName.value ||
      ''

    await ensureInstanceCanvasGroups(preferred)

    if (
      preferred &&
      instanceOptions.value.includes(preferred)
    ) {
      canvasInstanceName.value = preferred
    } else if (
      !canvasInstanceName.value ||
      !instanceOptions.value.includes(canvasInstanceName.value)
    ) {
      canvasInstanceName.value = instanceOptions.value[0] || ''
    }

    syncCanvasGroupByInstance()

    if (
      !currentSchema.value ||
      !schemaOptions.value.includes(currentSchema.value)
    ) {
      currentSchema.value =
        canvasInstanceName.value || schemaOptions.value[0] || ''
    }
  }

  /** 工具栏：切换实例画布并重新加载 */
  const onCanvasInstanceChange = async (name: string) => {
    if (switchingCanvas.value || !name) return
    switchingCanvas.value = true
    try {
      canvasInstanceName.value = name
      syncCanvasGroupByInstance()
      if (!currentCanvasGroupId.value) {
        await ensureInstanceCanvasGroups(name)
        syncCanvasGroupByInstance()
      }
      // 左侧目录默认跟着切到同实例，仍可再切去拉其他库表
      currentSchema.value = name
      tableFilter.value = ''
      await router.replace({
        query: { ...route.query, id: dbConfigId, instance: name },
      })
      await loadData({ skipInstanceResolve: true })
    } catch (e) {
      console.error(e)
      ElMessage.error('切换画布失败')
    } finally {
      switchingCanvas.value = false
    }
  }

  const loadData = async (opts?: { skipInstanceResolve?: boolean }) => {
    if (!graph) return

    const { data: config } = await getDbConfigById({ id: dbConfigId })
    dbConfigName.value = config ? config.dbName : ''

    if (!opts?.skipInstanceResolve) {
      await resolveInstancesAndCanvas(config)
    }

    const [{ data: lightCatalog }, { data: relationships }] = await Promise.all(
      [
        getCatalogTablesLight(dbConfigId),
        loadRelationCanvas(dbConfigId, currentCanvasGroupId.value),
      ],
    )

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

    const neededIds = new Set<string>()
    const rels = relationships || []
    const canvasSchema = canvasInstanceName.value

    // 当前实例画布：本实例有坐标的表 + 本画布关系中的表（可含其他实例）
    for (const t of lightCatalog || []) {
      if (t.posX == null || t.posY == null || t.id == null) continue
      if (canvasSchema && t.schemaName && t.schemaName !== canvasSchema) {
        continue
      }
      neededIds.add(String(t.id))
    }
    for (const r of rels) {
      if (r.sourceTableId != null) neededIds.add(String(r.sourceTableId))
      if (r.targetTableId != null) neededIds.add(String(r.targetTableId))
    }

    if (neededIds.size) {
      const { data: fullTables } = await getTablesWithColumnsByIds([
        ...neededIds,
      ])
      for (const t of fullTables || []) rememberCatalogTable(t)
    }

    restoring = true
    const history = graph.getPlugin('history') as History | undefined
    history?.disable()
    const nodes: any[] = []
    let idx = 0
    for (const id of neededIds) {
      const t = tableMap[id]
      if (!t) continue
      const light = catalogBySourceId[t.sourceTableId] || t
      const cx =
        light.posX != null
          ? light.posX
          : t.posX != null
            ? t.posX
            : 240 + (idx % 4) * (showAllFields.value ? 320 : 230)
      const cy =
        light.posY != null
          ? light.posY
          : t.posY != null
            ? t.posY
            : 160 + Math.floor(idx / 4) * (showAllFields.value ? 200 : 150)
      nodes.push(buildNodeMeta(t, cx, cy))
      idx++
    }
    const edges = rels
      .filter(
        (r: any) =>
          neededIds.has(String(r.sourceTableId)) &&
          neededIds.has(String(r.targetTableId)),
      )
      .map((r: any) => buildEdgeMeta(r))

    graph.fromJSON({ nodes, edges })
    await nextTick()
    history?.enable()
    restoring = false
    selectedNodeIds.value = []
    selectionPlugin?.clean()
    syncCanvasTableIds()

    await loadRemoteTables()
  }

  const saveCanvas = async () => {
    if (!graph) return
    const edges = graph.getEdges()
    const invalid = edges.filter((e) => {
      const data = (e.getData() || {}) as EdgeRelationData
      return !data.fields || !data.fields.length
    })
    if (invalid.length) {
      ElMessage.error('存在未配置字段映射的关系，请双击连线补充')
      return
    }
    saving.value = true
    try {
      await saveRelationCanvas({
        dbConfigId,
        canvasGroupId: currentCanvasGroupId.value,
        nodes: graph.getNodes().map((n) => {
          const pos = n.position()
          const size = n.size()
          const center = topLeftToCenter(pos.x, pos.y, size.width, size.height)
          const data = (n.getData() || {}) as TableNodeData
          return {
            tableId: data.tableId,
            posX: center.posX,
            posY: center.posY,
          }
        }),
        relationships: edges.map((e) => {
          const data = (e.getData() || {}) as EdgeRelationData
          return {
            sourceTableId: e.getSourceCellId(),
            targetTableId: e.getTargetCellId(),
            relationshipType: data.relationshipType,
            joinType: data.joinType,
            relationshipName: data.relationshipName,
            description: data.description,
            fields: data.fields,
          }
        }),
      })
      ElMessage.success('画布保存成功')
    } finally {
      saving.value = false
    }
  }

  const testPath = async () => {
    const tableIds = [...selectedNodeIds.value]
    const { data } = await findBestRelationshipPath({
      dbConfigId,
      tableIds,
      canvasGroupIds: currentCanvasGroupId.value
        ? [currentCanvasGroupId.value]
        : undefined,
    })
    pathResult.value = data
    pathDialogVisible.value = true
  }

  const goBack = async () => {
    await backToListPage(route, router, {
      listRouteName: 'VisualClient',
      fallbackPath: '/visual/client',
    })
  }

  onMounted(async () => {
    if (!dbConfigId) {
      ElMessage.error('缺少数据库配置ID')
      return
    }
    document.addEventListener('click', onGlobalClickCloseMenu)
    document.addEventListener('keydown', onGlobalKeyCloseMenu)
    initGraph()
    await loadData()
    nextTick(() => canvasRef.value?.focus())
  })

  const resizeGraphToContainer = () => {
    const el = canvasRef.value
    if (!graph || !el) return
    graph.resize(el.clientWidth, el.clientHeight)
  }

  const onCatalogTransitionEnd = (event: TransitionEvent) => {
    if (event.propertyName !== 'width') return
    resizeGraphToContainer()
  }

  watch(isDark, () => {
    applyThemeToGraph()
  })

  watch(showAllFields, async (on) => {
    localStorage.setItem(SHOW_FIELDS_KEY, on ? '1' : '0')
    if (on) await ensureCanvasColumns()
    refreshAllNodeVisuals()
  })

  watch(catalogCollapsed, (collapsed) => {
    localStorage.setItem(CATALOG_COLLAPSE_KEY, collapsed ? '1' : '0')
    nextTick(() => resizeGraphToContainer())
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', onGlobalClickCloseMenu)
    document.removeEventListener('keydown', onGlobalKeyCloseMenu)
    if (graph) {
      graph.dispose()
      graph = null
    }
    selectionPlugin = null
  })
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="relation-canvas-container">
    <div class="canvas-toolbar">
      <div class="toolbar-left">
        <el-button :icon="ArrowLeft" @click="goBack">{{ $tr('返回') }}</el-button>
        <el-select
          v-model="canvasInstanceName"
          :placeholder="$tr('切换画布实例')"
          size="default"
          filterable
          :disabled="switchingCanvas"
          style="width: 200px; margin-left: 12px"
          @change="onCanvasInstanceChange"
        >
          <el-option
            v-for="item in instanceOptions"
            :key="item"
            :label="item"
            :value="item"
          />
        </el-select>
        <div class="title-block">
          <span class="db-title">
            {{ dbConfigName
            }}{{ canvasInstanceName ? ` / ${canvasInstanceName}` : '' }} {{ $tr('- 关系画布') }}
          </span>
          <span class="canvas-hint">
            {{ $tr('空白拖动画布 · 拖节点移动 · 圆点拉线 · 双击连线或表 · Ctrl+滚轮缩放 · 表头颜色区分实例') }}
          </span>
        </div>
      </div>
      <div class="toolbar-right">
        <el-tooltip
          :content="$tr('打开后，画布上每张表会列出全部字段；字段很多时卡片会变高')"
          placement="bottom"
        >
          <div class="field-switch">
            <span>{{ $tr('显示全部字段') }}</span>
            <el-switch v-model="showAllFields" />
          </div>
        </el-tooltip>
        <el-tooltip
          :content="$tr('开启后点击表可叠加选中；也可按住 Shift / Ctrl 点选')"
          placement="bottom"
        >
          <el-button
            :type="multiSelectMode ? 'warning' : 'default'"
            @click="toggleMultiSelectMode"
          >
            {{ $tr(multiSelectMode ? '退出多选' : '多选模式') }}
          </el-button>
        </el-tooltip>
        <el-tooltip
          :content="$tr('请先多选至少 2 张表：开启「多选模式」后点击，或按住 Shift/Ctrl 点击')"
          placement="bottom"
        >
          <el-button :disabled="selectedNodeIds.length < 2" @click="testPath">
            {{ $tr('寻路测试（已选') }} {{ selectedNodeIds.length }} {{ $tr('表）') }}
          </el-button>
        </el-tooltip>
        <el-button type="primary" :loading="saving" @click="saveCanvas">
          {{ $tr('保存画布') }}
        </el-button>
      </div>
    </div>

    <div class="canvas-body" v-loading="switchingCanvas">
      <div
        class="table-catalog"
        :class="{ 'is-collapsed': catalogCollapsed }"
        @transitionend="onCatalogTransitionEnd"
      >
        <div class="catalog-bar">
          <span v-show="!catalogCollapsed" class="catalog-title">{{ $tr('表目录') }}</span>
          <el-tooltip
            :content="$tr(catalogCollapsed ? '展开表目录' : '收起表目录')"
            placement="right"
          >
            <el-button
              link
              class="catalog-fold"
              @click="catalogCollapsed = !catalogCollapsed"
            >
              <el-icon :size="16">
                <Fold v-if="!catalogCollapsed" />
                <Expand v-else />
              </el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <div
          v-if="catalogCollapsed"
          class="catalog-rail"
          @click="catalogCollapsed = false"
        >
          {{ $tr('表目录') }}
        </div>
        <template v-if="!catalogCollapsed">
        <div class="catalog-header">
          <el-select
            v-model="currentSchema"
            :placeholder="$tr('选择实例（拉表）')"
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
            :placeholder="$tr('搜索表名（推荐）')"
            size="small"
            :prefix-icon="Search"
          />
          <div class="catalog-meta">
            <span>{{ $tr('共') }} {{ filteredRemoteTables.length }} {{ $tr('张表') }}</span>
            <el-button
              link
              type="primary"
              size="small"
              :loading="remoteLoading"
              @click="loadRemoteTables"
            >
              {{ $tr('刷新') }}
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
            :style="{ height: `${filteredRemoteTables.length * LIST_ITEM_HEIGHT}px` }"
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
                  <el-tag v-if="isTableSynced(table)" size="small" type="info">
                    {{ $tr('已入库') }}
                  </el-tag>
                  <el-tag
                    v-if="isTableOnCanvas(table)"
                    size="small"
                    type="success"
                  >
                    {{ $tr('已在画布') }}
                  </el-tag>
                  <el-tag
                    v-if="syncingTableName === table.tableName"
                    size="small"
                    type="warning"
                  >
                    {{ $tr('同步中') }}
                  </el-tag>
                </div>
              </div>
            </div>
          </div>
          <el-empty
            v-if="!remoteLoading && !filteredRemoteTables.length"
            :description="$tr('未找到表，请切换数据库或调整搜索')"
            :image-size="80"
          />
        </div>
        <div class="catalog-tip">
          {{ $tr('上方切换「拉表实例」可跨库加表；工具栏切换的是整张实例画布。单击加入，右键可改名或移除。') }}
        </div>
        </template>
      </div>

      <div ref="canvasRef" class="x6-canvas" tabindex="0"></div>
    </div>

    <Teleport to="body">
      <div
        v-show="ctxMenu.visible"
        class="vq-ctx-menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @click.stop
      >
        <div
          class="vq-ctx-item"
          :class="{ disabled: ctxMenuOnCanvas }"
          @click="!ctxMenuOnCanvas && ctxMenuAdd()"
        >
          {{ $tr('添加到画布') }}
        </div>
        <div class="vq-ctx-item" @click="openRenameDialog()">
          {{ $tr('修改显示名称') }}
        </div>
        <div
          class="vq-ctx-item danger"
          :class="{ disabled: !ctxMenuOnCanvas }"
          @click="ctxMenuOnCanvas && ctxMenuRemove()"
        >
          {{ $tr('从画布删除') }}
        </div>
      </div>
    </Teleport>

    <el-dialog
      v-model="edgeDialogVisible"
      :title="$tr('编辑表关系')"
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
            <el-form-item :label="$tr('关系名称')">
              <el-input
                v-model="edgeForm.relationshipName"
                :placeholder="$tr('可选，如：订单-用户')"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="JOIN">
              <el-select v-model="edgeForm.joinType">
                <el-option label="LEFT" value="LEFT" />
                <el-option label="INNER" value="INNER" />
                <el-option label="RIGHT" value="RIGHT" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item :label="$tr('关系类型')">
              <el-select v-model="edgeForm.relationshipType">
                <el-option :label="$tr('一对一')" value="ONE_TO_ONE" />
                <el-option :label="$tr('一对多')" value="ONE_TO_MANY" />
                <el-option :label="$tr('多对一')" value="MANY_TO_ONE" />
                <el-option :label="$tr('多对多')" value="MANY_TO_MANY" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">
          {{ $tr('字段映射（多组之间 AND 连接）') }}
        </el-divider>
        <div
          v-for="(mapping, idx) in edgeForm.fields"
          :key="idx"
          class="mapping-row"
        >
          <el-select
            v-model="mapping.sourceFieldId"
            filterable
            :placeholder="$tr('源表字段')"
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
            :placeholder="$tr('目标表字段')"
            class="mapping-field"
          >
            <el-option
              v-for="f in fieldsOfTable(edgeForm.targetTableId)"
              :key="f.id"
              :label="fieldLabel(f)"
              :value="f.id"
            />
          </el-select>
          <el-checkbox v-model="mapping.isPrimaryMapping" :label="$tr('主映射')" />
          <el-button
            type="danger"
            link
            :disabled="edgeForm.fields.length <= 1"
            @click="removeMapping(idx)"
          >
            {{ $tr('删除') }}
          </el-button>
        </div>
        <el-button link type="primary" @click="addMapping">
          {{ $tr('+ 添加字段映射') }}
        </el-button>

        <el-form-item :label="$tr('描述')" style="margin-top: 12px">
          <el-input
            v-model="edgeForm.description"
            type="textarea"
            :rows="2"
            :placeholder="$tr('可选')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="danger" plain @click="deleteEdge">{{ $tr('删除该关系') }}</el-button>
        <el-button @click="cancelEdgeDialog">{{ $tr('取消') }}</el-button>
        <el-button type="primary" @click="confirmEdge">{{ $tr('确定') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pathDialogVisible" :title="$tr('自动寻路结果')" width="640px">
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
            {{ $tr('自动引入中间表：') }}
            <el-tag
              v-for="tid in pathResult.intermediateTableIds"
              :key="tid"
              type="warning"
              style="margin-right: 6px"
            >
              {{ tableLabel(tid) }}
            </el-tag>
          </div>
          <p class="path-card-note">
            {{ $tr('寻路只按连通最短路计算，一对一、一对多、多对一目前不参与选路，这里只展示关系上已保存的类型。') }}
          </p>
          <el-timeline>
            <el-timeline-item
              v-for="(rel, i) in pathResult.relationships"
              :key="rel.id"
              :timestamp="`第 ${Number(i) + 1} 步`"
            >
              {{ tableLabel(rel.sourceTableId) }}
              <el-tag size="small" style="margin: 0 4px">
                {{ rel.joinType || 'LEFT' }} JOIN
              </el-tag>
              <el-tag size="small" type="info" style="margin-right: 4px">
                {{ $tr(relTypeLabel(rel.relationshipType)) }}
              </el-tag>
              {{ tableLabel(rel.targetTableId) }}
            </el-timeline-item>
          </el-timeline>
        </template>
      </template>
    </el-dialog>

    <el-dialog
      v-model="tableInfoVisible"
      :title="`表信息 · ${tableInfo.displayName || tableInfo.tableName || ''}`"
      width="780px"
      destroy-on-close
    >
      <div v-loading="tableInfoLoading" class="table-info-dialog">
        <el-form label-width="100px" class="table-info-name-form">
          <el-form-item :label="$tr('显示名称')">
            <el-input
              v-model="tableInfo.displayName"
              :placeholder="$tr('表头显示名 / 注释')"
              maxlength="200"
              show-word-limit
            />
          </el-form-item>
          <el-form-item :label="$tr('同步库注释')">
            <el-checkbox v-model="tableInfo.syncRemoteComment">
              {{ $tr('同步修改数据库表注释') }}
            </el-checkbox>
            <div class="table-info-sync-tip">
              {{ $tr('勾选：同时改远端库 COMMENT；不勾选：仅改本系统目录/画布显示名') }}
            </div>
          </el-form-item>
        </el-form>
        <el-descriptions :column="2" border size="small" class="table-info-meta">
          <el-descriptions-item :label="$tr('表名')">
            {{ tableInfo.tableName || '-' }}
          </el-descriptions-item>
          <el-descriptions-item :label="$tr('实例')">
            <span class="schema-dot" :style="{ background: headerColorForSchema(tableInfo.schemaName) }"></span>
            {{ tableInfo.schemaName || '-' }}
          </el-descriptions-item>
          <el-descriptions-item :label="$tr('字段数')">
            {{ tableInfo.columns.length }}
          </el-descriptions-item>
        </el-descriptions>
        <el-table
          :data="tableInfo.columns"
          border
          stripe
          size="small"
          max-height="360"
          style="margin-top: 12px"
          :empty-text="$tr('暂无字段信息')"
        >
          <el-table-column
            :label="$tr('字段名')"
            min-width="140"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ row.fieldName || row.columnName || '-' }}
            </template>
          </el-table-column>
          <el-table-column
            :label="$tr('类型')"
            min-width="120"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ row.dataType || row.columnType || '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="$tr('可空')" width="70" align="center">
            <template #default="{ row }">
              {{ $tr(row.isNullable === 1 ||
                row.isNullable === true ||
                row.nullable === true ||
                row.nullable === 1 ||
                row.isNullable === 'YES'
                  ? '是'
                  : '否') }}
            </template>
          </el-table-column>
          <el-table-column :label="$tr('主键')" width="70" align="center">
            <template #default="{ row }">
              {{ $tr(row.isPrimary === 1 ||
                row.isPrimary === true ||
                row.primaryKey ||
                row.isPrimaryKey ||
                row.pk
                  ? '是'
                  : '') }}
            </template>
          </el-table-column>
          <el-table-column
            :label="$tr('注释')"
            min-width="160"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{
                row.displayName &&
                row.displayName !== row.fieldName &&
                row.displayName !== row.columnName
                  ? row.displayName
                  : row.description ||
                    row.columnComment ||
                    row.comment ||
                    ''
              }}
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="tableInfoVisible = false">{{ $tr('关闭') }}</el-button>
        <el-button
          type="primary"
          :loading="tableInfoSaving"
          @click="saveTableDisplayNameFromInfo"
        >
          {{ $tr('保存显示名称') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="renameDialogVisible"
      :title="$tr('修改显示名称')"
      width="480px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item :label="$tr('表名')">
          <el-input :model-value="renameForm.tableName" disabled />
        </el-form-item>
        <el-form-item :label="$tr('实例')">
          <el-input :model-value="renameForm.schemaName" disabled />
        </el-form-item>
        <el-form-item :label="$tr('显示名称')" required>
          <el-input
            v-model="renameForm.displayName"
            :placeholder="$tr('将写入数据库表注释')"
            maxlength="200"
            show-word-limit
            @keyup.enter="confirmRenameFromCatalog"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">{{ $tr('取消') }}</el-button>
        <el-button
          type="primary"
          :loading="renameSaving"
          @click="confirmRenameFromCatalog"
        >
          {{ $tr('确定') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
  </Page>
</template>

<style lang="scss" scoped>
  .relation-canvas-container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    padding: 12px;

    .canvas-toolbar {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      margin-bottom: 8px;
      background: var(--el-bg-color);
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 8px;

      .title-block {
        display: flex;
        flex-direction: column;
        min-width: 0;
        margin-left: 4px;
      }

      .db-title {
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--el-text-color-primary);
        white-space: nowrap;
      }

      .canvas-hint {
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;
        line-height: 1.3;
        color: var(--el-text-color-secondary);
        white-space: nowrap;
      }

      .toolbar-left,
      .toolbar-right {
        display: flex;
        gap: 8px;
        align-items: center;
        min-width: 0;
      }

      .toolbar-left {
        flex: 1;
      }

      .toolbar-right {
        flex-shrink: 0;
      }

      .field-switch {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 0 10px;
        font-size: 13px;
        color: var(--el-text-color-regular);
        white-space: nowrap;
        border-right: 1px solid var(--el-border-color-lighter);
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
        flex-shrink: 0;
        width: 280px;
        overflow: hidden;
        background: var(--el-bg-color);
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 8px;
        transition: width 0.2s ease;

        &.is-collapsed {
          width: 44px;

          .catalog-bar {
            justify-content: center;
            padding-right: 0;
            padding-left: 0;
            border-bottom: none;
          }
        }

        .catalog-bar {
          display: flex;
          flex-shrink: 0;
          align-items: center;
          justify-content: space-between;
          height: 40px;
          padding: 0 8px 0 12px;
          border-bottom: 1px solid var(--el-border-color-lighter);
        }

        .catalog-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--el-text-color-primary);
        }

        .catalog-fold {
          padding: 4px;
        }

        .catalog-rail {
          display: flex;
          flex: 1;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: var(--el-text-color-secondary);
          letter-spacing: 2px;
          cursor: pointer;
          writing-mode: vertical-rl;

          &:hover {
            color: var(--el-color-primary);
            background: var(--el-fill-color-light);
          }
        }

        .catalog-header {
          padding: 8px;
          border-bottom: 1px solid var(--el-border-color-lighter);

          .catalog-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 6px;
            font-size: 12px;
            color: var(--el-text-color-secondary);
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
          border-bottom: 1px solid var(--el-border-color-lighter);
          transition: background 0.15s;

          &:hover {
            background: var(--el-color-primary-light-9);
          }

          &.on-canvas {
            background: var(--el-color-success-light-9);
            box-shadow: inset 3px 0 0 var(--el-color-success);
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
            color: var(--el-text-color-primary);
            white-space: nowrap;
          }

          .catalog-item-code {
            margin-top: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 12px;
            color: var(--el-text-color-secondary);
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
          color: var(--el-text-color-secondary);
          background: var(--el-fill-color-lighter);
          border-top: 1px solid var(--el-border-color-lighter);
        }
      }

      .x6-canvas {
        flex: 1;
        min-width: 0;
        outline: none;
        background: transparent;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 8px;

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
  .vq-ctx-menu {
    position: fixed;
    z-index: 4000;
    min-width: 140px;
    padding: 4px 0;
    user-select: none;
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    box-shadow: var(--el-box-shadow-light);

    .vq-ctx-item {
      padding: 8px 14px;
      font-size: 13px;
      line-height: 1.4;
      color: var(--el-text-color-primary);
      cursor: pointer;

      &:hover:not(.disabled) {
        color: var(--el-color-primary);
        background: var(--el-fill-color-light);
      }

      &.danger:hover:not(.disabled) {
        color: var(--el-color-danger);
        background: var(--el-color-danger-light-9);
      }

      &.disabled {
        color: var(--el-text-color-disabled);
        cursor: not-allowed;
      }
    }
  }

  .table-info-dialog {
    min-height: 120px;
  }

  .table-info-name-form {
    margin-bottom: 8px;

    .table-info-sync-tip {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--el-text-color-secondary);
    }
  }

  .path-card-note {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
  }

  .schema-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    vertical-align: middle;
    border-radius: 2px;
  }

  .x6-port-body {
    cursor: crosshair;
  }

  .x6-node-selected [magnet='true'] {
    stroke: #409eff !important;
    stroke-width: 2.5px !important;
  }
</style>
