# YiCh Beauty System - 设计手册入口

本目录用于沉淀一宸 YiCh 美业门店系统的框架设计、角色体系、Admin 端规格和邀请码流程。

## 阅读顺序

1. [FRAMEWORK-DESIGN.md](./FRAMEWORK-DESIGN.md)  
   先读这一份，理解三端架构、角色体系、前端目录结构、布局方案和实施步骤。

2. [INVITE-FLOW.md](./INVITE-FLOW.md)  
   员工邀请码注册流程的完整规格，包括老板生成邀请码、员工加入、状态流转和前端 UI。

3. [ADMIN-SPEC.md](./ADMIN-SPEC.md)  
   超级管理员端规格，包括 Admin 账号、全局看板、门店管理、系统配置、审计日志、API 和数据库迁移建议。

4. [UI-FUNCTION-GAPS.md](./UI-FUNCTION-GAPS.md)  
   当前 UI 已完成但功能未完成的备注，给后续开发同事接手补功能使用。

## 当前实施原则

- 先拆前端结构，再补新功能。
- 先统一设计系统，再逐页美化。
- B端老板和员工共用同一套系统，通过角色权限区分首页和可见模块。
- C端、B端、Admin端共用一个 React 应用和同一个 Cloudflare Pages 部署。
- 员工只能通过邀请码加入门店，不能自行注册。
