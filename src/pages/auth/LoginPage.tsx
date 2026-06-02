import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setJoinNotice(undefined);
    if (mode === "login") {
      void onLogin(account.trim(), password);
      return;
    }
    let result: JoinInviteResult;
    try {
      result = await onJoin({
        inviteCode,
        name: joinName,
        password,
        storeName: isOwnerInvite ? joinStoreName : undefined,
        phone: isOwnerInvite ? joinPhone : undefined,
        address: isOwnerInvite ? joinAddress : undefined,
        account: isOwnerInvite ? joinAccount : undefined,
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
      {error && (
        <div className="login-error-toast" role="alert" aria-live="assertive">
          {error}
        </div>
      )}
      {joinNotice && (
        <div className="login-notice-toast" role="status" aria-live="polite">
          {joinNotice}
        </div>
      )}
      <section className="login-panel">
        <div className="login-unified-card">
          <div className="login-hero">
            <div className="login-brand">
              <div className="brand-mark">D</div>
              <div>
                <strong>一宸 YiCh 美业门店系统</strong>
                <span>门店经营管理平台</span>
              </div>
            </div>
          </div>
          <form className={`login-card login-card-${mode}`} onSubmit={submit}>
            <div className="login-card-head">
              <strong>{mode === "login" ? "登录系统" : "邀请码加入"}</strong>
            </div>
            {mode === "join" ? (
              <>
                <label>邀请码<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="请输入门店发放的邀请码" /></label>
                <label>姓名<input value={joinName} onChange={(event) => setJoinName(event.target.value)} placeholder="请输入姓名" /></label>
                {isOwnerInvite && (
                  <>
                    <label>门店名称<input value={joinStoreName} onChange={(event) => setJoinStoreName(event.target.value)} placeholder="请输入门店名称" required /></label>
                    <label>联系电话<input value={joinPhone} onChange={(event) => setJoinPhone(event.target.value)} placeholder="请输入门店联系电话" required /></label>
                    <label>门店地址<input value={joinAddress} onChange={(event) => setJoinAddress(event.target.value)} placeholder="请输入门店地址" /></label>
                    <label>老板登录账号<input value={joinAccount} onChange={(event) => setJoinAccount(event.target.value)} placeholder="手机号或邮箱" required /></label>
                  </>
                )}
              </>
            ) : (
              <label>
                账号
                <input value={account} onChange={(event) => setAccount(event.target.value)} />
              </label>
            )}
            <label>
              密码
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
            </label>
            {error && <p className="form-error">{error}</p>}
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
