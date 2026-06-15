import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";

type UserAvatarProps = {
  avatarUrl?: string;
  size?: number;
  showImage?: boolean;
};

export function UserAvatar({ avatarUrl, size = 22, showImage = false }: UserAvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | undefined>();

  useEffect(() => {
    setFailedAvatarUrl(undefined);
  }, [avatarUrl]);

  const canShowImage = showImage && avatarUrl && failedAvatarUrl !== avatarUrl;
  return (
    <span className="user-avatar-image">
      <UserRound className="user-avatar-fallback-icon" size={size} />
      {canShowImage && (
        <img src={avatarUrl} alt="" onLoad={() => setFailedAvatarUrl(undefined)} onError={() => setFailedAvatarUrl(avatarUrl)} />
      )}
    </span>
  );
}

export default UserAvatar;
