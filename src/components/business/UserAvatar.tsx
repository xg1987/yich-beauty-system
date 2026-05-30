import { UserRound } from "lucide-react";

type UserAvatarProps = {
  avatarUrl?: string;
  size: number;
};

export function UserAvatar({ avatarUrl, size }: UserAvatarProps) {
  if (avatarUrl) return <img src={avatarUrl} alt="" />;
  return <UserRound size={size} />;
}

export default UserAvatar;
