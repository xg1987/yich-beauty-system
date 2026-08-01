import { strToU8, zipSync } from "fflate";
import type {
  CustomerMonthlyTrendPoint,
  CustomerPeriodReport,
  ProductUsageReportRow,
  ServiceDeliveryReport,
} from "../domain/reporting";

type WorkbookSummary = {
  revenue: number;
  netRevenue: number;
  grossProfit: number;
  grossMargin: number;
  refundAmount: number;
  serviceCount: number;
  averageOrderValue: number;
};

export type BusinessWorkbookInput = {
  storeName: string;
  periodLabel: string;
  generatedAt: Date;
  summary: WorkbookSummary;
  customerReport: CustomerPeriodReport;
  customerTrend: CustomerMonthlyTrendPoint[];
  serviceDelivery: ServiceDeliveryReport;
  productUsage: ProductUsageReportRow[];
};

type CellStyle = "default" | "header" | "percent" | "currency" | "status-red" | "status-yellow" | "status-purple" | "status-blue" | "status-green" | "label";
type CellValue = string | number;
type WorkbookCell = {
  value: CellValue;
  style?: CellStyle;
};
type WorkbookSheet = {
  name: string;
  widths: number[];
  rows: Array<Array<CellValue | WorkbookCell>>;
};

const styleIds: Record<CellStyle, number> = {
  default: 0,
  header: 1,
  percent: 2,
  currency: 3,
  "status-red": 4,
  "status-yellow": 5,
  "status-purple": 6,
  "status-blue": 7,
  "status-green": 8,
  label: 9,
};

const statusStyles: Record<ProductUsageReportRow["status"], CellStyle> = {
  "立即补货": "status-red",
  "准备补货": "status-yellow",
  "临期关注": "status-purple",
  "需完善扣耗": "status-blue",
  "库存充足": "status-green",
};

function styled(value: CellValue, style: CellStyle): WorkbookCell {
  return { value, style };
}

function moneyCell(value: number) {
  return styled(Math.round(value * 100) / 100, "currency");
}

function percentCell(value: number) {
  return styled(value, "percent");
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellParts(input: CellValue | WorkbookCell) {
  if (typeof input === "object") return input;
  return { value: input, style: "default" as CellStyle };
}

function cellXml(input: CellValue | WorkbookCell, rowIndex: number, columnIndex: number) {
  const { value, style = "default" } = cellParts(input);
  const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
  const styleId = styleIds[style];
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function worksheetXml(sheet: WorkbookSheet) {
  const maxColumns = Math.max(1, ...sheet.rows.map((row) => row.length));
  const maxRows = Math.max(1, sheet.rows.length);
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const width = sheet.widths[index] ?? 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => cellXml(cell, rowIndex, columnIndex)).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const range = `A1:${columnName(maxColumns - 1)}${maxRows}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${range}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${columns}</cols>
  <sheetData>${rows}</sheetData>
  <autoFilter ref="${range}"/>
</worksheet>`;
}

function workbookXml(sheets: WorkbookSheet[]) {
  const entries = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="18000"/></bookViews>
  <sheets>${entries}</sheets>
  <calcPr calcId="191029"/>
</workbook>`;
}

function workbookRelationshipsXml(sheetCount: number) {
  const sheetEntries = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetEntries}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheetCount: number) {
  const sheetEntries = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheetEntries}
</Types>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="¥#,##0.00"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/></font>
    <font><b/><color rgb="FF2F255F"/><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF6F42C1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFECACA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE9D5FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9CBEF"/></left>
      <right style="thin"><color rgb="FFD9CBEF"/></right>
      <top style="thin"><color rgb="FFD9CBEF"/></top>
      <bottom style="thin"><color rgb="FFD9CBEF"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appPropertiesXml(sheets: WorkbookSheet[]) {
  const titles = sheets.map((sheet) => `<vt:lpstr>${xmlEscape(sheet.name)}</vt:lpstr>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>祝融｜坤锋美业门店系统</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts>
</Properties>`;
}

function corePropertiesXml(input: BusinessWorkbookInput) {
  const createdAt = input.generatedAt.toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>祝融｜坤锋美业门店系统</dc:creator>
  <dc:title>${xmlEscape(`${input.storeName}-${input.periodLabel}经营分析`)}</dc:title>
  <dc:subject>${xmlEscape(`${input.periodLabel}经营分析`)}</dc:subject>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`;
}

function workbookSheets(input: BusinessWorkbookInput): WorkbookSheet[] {
  const header = (values: string[]) => values.map((value) => styled(value, "header"));
  const summarySheet: WorkbookSheet = {
    name: "经营概览",
    widths: [22, 20, 42],
    rows: [
      header(["指标", "结果", "说明"]),
      ["门店", input.storeName, "当前登录门店"],
      ["统计周期", input.periodLabel, "与页面选择保持一致"],
      ["实收金额", moneyCell(input.summary.revenue), "订单和会员卡实收现金流"],
      ["净收入", moneyCell(input.summary.netRevenue), "实收金额减退款"],
      ["毛利", moneyCell(input.summary.grossProfit), "净收入减商品及耗材成本"],
      ["毛利率", percentCell(input.summary.grossMargin), "毛利除以实收金额"],
      ["退款金额", moneyCell(input.summary.refundAmount), "退款记录合计"],
      ["订单数", input.summary.serviceCount, "有效收银订单"],
      ["客单价", moneyCell(input.summary.averageOrderValue), "实收金额除以订单数"],
      ["本期新增客户", input.customerReport.newCustomerCount, "首次有效消费发生在本期的客户"],
      ["本期到店客户", input.customerReport.activeCustomerCount, "本期有效消费客户去重"],
      ["老客回店人数", input.customerReport.returningCustomerCount, "首次消费早于本期且本期再次消费"],
      ["老客回店占比", percentCell(input.customerReport.returningRate), "老客回店人数除以本期到店客户"],
      ["门店总客户数", input.customerReport.totalCustomerCount, "门店累计有效客户档案"],
      ["本期到店次数", input.customerReport.visitCount, "本期有效消费订单数"],
      ["新客消费金额", moneyCell(input.customerReport.newCustomerRevenue), "本期新客有效消费"],
      ["老客消费金额", moneyCell(input.customerReport.returningCustomerRevenue), "本期老客有效消费"],
      ["客户服务项目数", input.serviceDelivery.projectCount, "次数卡及套餐卡涉及的服务项目种类"],
      ["客户购买服务总次数", input.serviceDelivery.totalTimes, "门店未退卡的次数卡及套餐卡累计服务次数"],
      ["已经交付次数", input.serviceDelivery.deliveredTimes, "购买总次数减当前剩余次数"],
      ["还未交付次数", input.serviceDelivery.remainingTimes, `${input.serviceDelivery.pendingCustomerCount}位客户仍有待服务次数`],
      ["服务项目交付率", percentCell(input.serviceDelivery.deliveryRate), "已经交付次数除以购买总次数"],
    ],
  };

  const trendSheet: WorkbookSheet = {
    name: "月度客户趋势",
    widths: [18, 14, 14, 14, 18, 18],
    rows: [
      header(["月份", "新增客户", "老客回店", "到店客户", "累计消费客户", "消费金额"]),
      ...input.customerTrend.map((item) => [
        item.fullLabel,
        item.newCustomerCount,
        item.returningCustomerCount,
        item.activeCustomerCount,
        item.cumulativePayingCustomerCount,
        moneyCell(item.revenue),
      ]),
    ],
  };

  const customerSheet: WorkbookSheet = {
    name: "客户明细",
    widths: [18, 16, 12, 16, 18, 16, 18],
    rows: [
      header(["客户", "手机号", "类型", "首次消费", "本期最后消费", "本期到店次数", "本期消费金额"]),
      ...input.customerReport.details.map((item) => [
        item.name,
        item.phone,
        item.customerType,
        formatDate(item.firstPurchaseAt),
        formatDate(item.lastPurchaseAt),
        item.visitCount,
        moneyCell(item.paidAmount),
      ]),
    ],
  };

  const deliverySummarySheet: WorkbookSheet = {
    name: "服务交付汇总",
    widths: [30, 14, 14, 16, 16, 16, 16],
    rows: [
      header(["服务项目", "购买客户", "项目卡", "购买总次数", "已经交付", "还未交付", "交付率"]),
      [
        "门店合计",
        input.serviceDelivery.customerCount,
        input.serviceDelivery.cardCount,
        input.serviceDelivery.totalTimes,
        input.serviceDelivery.deliveredTimes,
        input.serviceDelivery.remainingTimes,
        percentCell(input.serviceDelivery.deliveryRate),
      ],
      ...input.serviceDelivery.projects.map((item) => [
        item.serviceName,
        item.customerCount,
        item.cardCount,
        item.totalTimes,
        item.deliveredTimes,
        item.remainingTimes,
        percentCell(item.deliveryRate),
      ]),
    ],
  };

  const deliveryDetailSheet: WorkbookSheet = {
    name: "待交付明细",
    widths: [16, 16, 30, 24, 14, 14, 14, 14, 16, 14, 20],
    rows: [
      header(["客户", "手机号", "服务项目", "项目卡", "卡状态", "购买总次数", "已经交付", "还未交付", "交付状态", "有效期", "数据口径"]),
      ...input.serviceDelivery.details.map((item) => [
        item.customerName,
        item.phone,
        item.serviceName,
        item.cardName,
        item.cardStatus,
        item.totalTimes,
        item.deliveredTimes,
        item.remainingTimes,
        item.remainingTimes > 0 ? "待交付" : "已交付完",
        item.expiresAt,
        item.dataSource,
      ]),
    ],
  };

  const productSheet: WorkbookSheet = {
    name: "产品使用明细",
    widths: [22, 16, 34, 16, 14, 12, 12, 12, 16, 14, 14, 18, 16, 16, 16, 16],
    rows: [
      header(["产品", "类型", "关联项目", "项目使用次数", "服务扣库", "销售", "赠送", "报损", "本期总出库", "当前库存", "预警库存", "近30天日均出库", "预计可用天数", "30天内临期", "补货状态", "建议采购量"]),
      ...input.productUsage.map((item) => [
        item.name,
        item.typeLabel,
        item.linkedServiceNames.join("、") || "-",
        item.serviceUseCount,
        item.serviceConsumedQuantity,
        item.soldQuantity,
        item.giftedQuantity,
        item.lossQuantity,
        item.totalOutboundQuantity,
        item.currentStock,
        item.warningStock,
        item.averageDailyOutbound,
        item.daysCover ?? "-",
        item.expiringQuantity,
        styled(item.status, statusStyles[item.status]),
        item.suggestedPurchaseQuantity,
      ]),
    ],
  };

  const attentionRows = input.productUsage.filter((item) => item.status !== "库存充足");
  const restockSheet: WorkbookSheet = {
    name: "补货建议",
    widths: [16, 22, 16, 16, 16, 18, 18, 46],
    rows: [
      header(["优先级", "产品", "当前库存", "预警库存", "日均出库", "预计可用天数", "建议采购量", "说明"]),
      ...attentionRows.map((item) => [
        styled(item.status, statusStyles[item.status]),
        item.name,
        `${item.currentStock}${item.unit}`,
        `${item.warningStock}${item.unit}`,
        item.averageDailyOutbound,
        item.daysCover ?? "-",
        `${item.suggestedPurchaseQuantity}${item.unit}`,
        item.status === "需完善扣耗"
          ? "产品已关联服务项目，但尚未启用自动扣耗，补货预测可能偏低"
          : item.status === "临期关注"
            ? `30天内临期 ${item.expiringQuantity}${item.unit}`
            : "按当前库存、预警值和近30天消耗计算",
      ]),
    ],
  };

  const definitionSheet: WorkbookSheet = {
    name: "指标说明",
    widths: [22, 48, 46],
    rows: [
      header(["指标", "计算口径", "注意事项"]),
      [styled("新增客户", "label"), "客户第一笔有效消费发生在所选周期", "仅建档但未消费不计入新增到店客户"],
      [styled("到店客户", "label"), "所选周期内存在有效消费订单的客户去重人数", "同一客户多次到店只计1人"],
      [styled("老客回店", "label"), "第一笔有效消费早于所选周期，且本期再次消费", "区别于同一周期消费2次"],
      [styled("服务购买总次数", "label"), "未退卡的次数卡及套餐卡累计服务权益次数", "储值卡、折扣卡不计入服务次数交付"],
      [styled("已经交付", "label"), "服务购买总次数减去当前剩余次数", "退款恢复的次数不计作已交付"],
      [styled("还未交付", "label"), "当前次数卡及套餐卡仍可使用的服务次数", "冻结或过期卡仍保留显示，便于门店核查责任"],
      [styled("项目使用次数", "label"), "有效订单中的服务项目关联了该产品的次数", "不等同于库存扣减数量"],
      [styled("服务扣库", "label"), "服务结账时实际记录的库存扣减数量", "未启用项目扣耗的产品会显示0"],
      [styled("预计可用天数", "label"), "当前库存除以近30天日均出库", "没有可追踪消耗时不计算"],
      [styled("建议采购量", "label"), "补足到30天预计用量或2倍预警库存的较高值", "采购周期和安全库存完善后可继续细化"],
    ],
  };

  return [
    summarySheet,
    trendSheet,
    customerSheet,
    deliverySummarySheet,
    deliveryDetailSheet,
    productSheet,
    restockSheet,
    definitionSheet,
  ];
}

export function buildBusinessWorkbook(input: BusinessWorkbookInput) {
  const sheets = workbookSheets(input);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypesXml(sheets.length)),
    "_rels/.rels": strToU8(rootRelationshipsXml()),
    "docProps/app.xml": strToU8(appPropertiesXml(sheets)),
    "docProps/core.xml": strToU8(corePropertiesXml(input)),
    "xl/workbook.xml": strToU8(workbookXml(sheets)),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationshipsXml(sheets.length)),
    "xl/styles.xml": strToU8(stylesXml()),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return {
    bytes: zipSync(files, { level: 6 }),
    filename: `${safeFilename(input.storeName)}-${safeFilename(input.periodLabel)}经营分析.xlsx`,
  };
}

export async function exportBusinessWorkbook(input: BusinessWorkbookInput) {
  const { bytes, filename } = buildBusinessWorkbook(input);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
  return filename;
}
