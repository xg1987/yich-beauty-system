import type { Permission } from "../domain/auth";
import type { UserRole } from "../domain/types";

export const permissionLabels: Record<Permission, string> = {
  "dashboard:view": "今日总览",
  "appointments:manage": "预约管理",
  "pos:manage": "开单收银",
  "customers:manage": "客户档案",
  "marketing:manage": "营销中心",
  "catalog:manage": "项目商品",
  "staff:view": "查看员工",
  "staff:manage": "员工管理",
  "commissions:settle": "提成结算",
  "inventory:manage": "库存管理",
  "reports:view": "报表分析",
  "approvals:manage": "审批中心",
  "logs:view": "操作日志",
  "settings:view": "系统设置",
};

export const permissionOptions = (Object.keys(permissionLabels) as Permission[]).map((permission) => ({
  value: permission,
  label: permissionLabels[permission],
}));

export const roleScopeLabels: Record<UserRole, string> = {
  superadmin: "平台级",
  owner: "门店全部",
  manager: "门店管理",
  frontdesk: "到店业务",
  therapist: "预约按门店开关",
  finance: "财务处理",
};
