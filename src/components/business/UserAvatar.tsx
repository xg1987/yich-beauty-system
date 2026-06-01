import { UserRound } from "lucide-react";

type UserAvatarProps = {
  avatarUrl?: string;
  size: number;
  showImage?: boolean;
};

export function UserAvatar({ avatarUrl, size, showImage = false }: UserAvatarProps) {
  if (showImage && avatarUrl) return <img src={avatarUrl} alt="" />;
  return <UserRound size={size} />;
}

export default UserAvatar;
