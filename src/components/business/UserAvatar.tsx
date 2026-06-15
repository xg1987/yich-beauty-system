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
  if (canShowImage) {
    return (
      <span className="user-avatar-image">
        <UserRound className="user-avatar-fallback-icon" size={size} />
        <img src={avatarUrl} alt="" onLoad={() => setFailedAvatarUrl(undefined)} onError={() => setFailedAvatarUrl(avatarUrl)} />
      </span>
    );
  }
  return <UserRound size={size} />;
}

export default UserAvatar;
