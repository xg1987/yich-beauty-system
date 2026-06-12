import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { BrandIcon } from "../../components/business/BrandIcon";
import { isPlatformInviteCodeFormat } from "../../domain/business";
import type { UserSession } from "../../domain/auth";
import type { JoinInviteResult } from "../../api/client";

type LoginPageProps = {
  onLogin: (account: string, password: string) => Promise<void>;
  onJoin: (body: { inviteCode: string; name: string; password: string; storeName?: string; phone?: string; address?: string; account?: string }) => Promise<JoinInviteResult>;
  authenticate: (authAction: () => Promise<UserSession>) => Promise<void>;
  loading: boolean;
  error?: string;
};

function isPendingApprovalResult(result: JoinInviteResult): result is Extract<JoinInviteResult, { status: "pending_approval" }> {
  return "status" in result && result.status === "pending_approval";
}

export default function LoginPage({ onLogin, onJoin, authenticate, loading, error }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "join">("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinStoreName, setJoinStoreName] = useState("");
  const [joinPhone, setJoinPhone] = useState("");
  const [joinAddress, setJoinAddress] = useState("");
  const [joinAccount, setJoinAccount] = useState("");
  const [joinNotice, setJoinNotice] = useState<string | undefined>();
  const isOwnerInvite = isPlatformInviteCodeFormat(inviteCode);
  const isPendingApprovalLogin = mode === "login" && error?.includes("等待店长审批");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJoinNotice(undefined);
    if (mode === "login") {
      void onLogin(account.trim(), password);
      return;
    }

    const formData = new FormData(event.currentTarget);
    const formString = (key: string, fallback: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : fallback;
    };
    const submittedInviteCode = formString("inviteCode", inviteCode).trim();
    const submittedName = formString("name", joinName).trim();
    const submittedPassword = formString("password", password);
    const submittedStoreName = formString("storeName", joinStoreName).trim();
    const submittedPhone = formString("phone", joinPhone).trim();
    const submittedAddress = formString("address", joinAddress).trim();
    const submittedAccount = formString("account", joinAccount).trim();
    const submittedIsOwnerInvite = isPlatformInviteCodeFormat(submittedInviteCode);

    if (!submittedName) {
      setJoinNotice("请填写姓名");
      return;
    }

    let result: JoinInviteResult;
    try {
      result = await onJoin({
        inviteCode: submittedInviteCode,
        name: submittedName,
        password: submittedPassword,
        storeName: submittedIsOwnerInvite ? submittedStoreName : undefined,
        phone: submittedIsOwnerInvite ? submittedPhone : undefined,
        address: submittedIsOwnerInvite ? submittedAddress : undefined,
        account: submittedAccount,
      });
    } catch {
      return;
    }

    if (isPendingApprovalResult(result)) {
      setJoinNotice(result.message);
      setMode("login");
      setPassword("");
      return;
    }

    await authenticate(() => Promise.resolve(result));
  };

  return (
    <div className="login-page">
      {joinNotice && (
        <div className="login-notice-toast" role="status" aria-live="polite">
          {joinNotice}
        </div>
      )}
      <section className="login-panel">
        <div className="login-unified-card">
          <div className="login-hero">
            <div className="login-brand">
              <BrandIcon className="brand-mark brand-icon-mark" />
              <div>
                <strong>祝融｜坤锋美业门店系统</strong>
                <span>门店经营管理平台</span>
              </div>
            </div>
          </div>
          <form className={`login-card login-card-${mode}`} onSubmit={submit}>
            <div className="login-card-head">
              <strong>{mode === "login" ? "登录系统" : "邀请码加入"}</strong>
            </div>
            {error && !isPendingApprovalLogin && (
              <div className="login-error-toast" role="alert" aria-live="assertive">
                {error}
              </div>
            )}
            {mode === "join" ? (
              <>
                <label>邀请码<input name="inviteCode" value={inviteCode} onInput={(event) => setInviteCode(event.currentTarget.value)} onChange={(event) => setInviteCode(event.target.value)} placeholder="请输入门店发放的邀请码" required /></label>
                <label>姓名<input name="name" value={joinName} onInput={(event) => setJoinName(event.currentTarget.value)} onChange={(event) => setJoinName(event.target.value)} onCompositionEnd={(event) => setJoinName(event.currentTarget.value)} autoComplete="name" placeholder="请输入姓名" required /></label>
                {isOwnerInvite && (
                  <>
                    <label>门店名称<input name="storeName" value={joinStoreName} onInput={(event) => setJoinStoreName(event.currentTarget.value)} onChange={(event) => setJoinStoreName(event.target.value)} placeholder="请输入门店名称" required /></label>
                    <label>联系电话<input name="phone" type="tel" inputMode="tel" autoComplete="tel" value={joinPhone} onInput={(event) => setJoinPhone(event.currentTarget.value)} onChange={(event) => setJoinPhone(event.target.value)} placeholder="请输入门店联系电话" required /></label>
                    <label>门店地址<input name="address" value={joinAddress} onInput={(event) => setJoinAddress(event.currentTarget.value)} onChange={(event) => setJoinAddress(event.target.value)} placeholder="请输入门店地址" /></label>
                  </>
                )}
                <label>{isOwnerInvite ? "店长登录账号" : "登录账号"}<input name="account" value={joinAccount} onInput={(event) => setJoinAccount(event.currentTarget.value)} onChange={(event) => setJoinAccount(event.target.value)} placeholder="手机号或邮箱" required /></label>
              </>
            ) : (
              <label>
                账号
                <input name="account" value={account} onChange={(event) => setAccount(event.target.value)} />
                {isPendingApprovalLogin && (
                  <span className="login-field-notice" role="alert" aria-live="assertive">
                    等待店长审批，通过后即可登录
                  </span>
                )}
              </label>
            )}
            <label>
              密码
              <input name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
            </label>
            <button className="primary-button" disabled={loading}>
              <LockKeyhole size={17} />
              {loading ? "处理中" : mode === "login" ? "进入系统" : "加入门店"}
            </button>
            <div className="login-card-links">
              {mode !== "login" && <button type="button" onClick={() => setMode("login")}>返回登录</button>}
              {mode !== "join" && <button type="button" onClick={() => setMode("join")}>已有邀请码？加入门店</button>}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
