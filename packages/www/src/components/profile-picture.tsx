import { createSignal, type JSX, onMount } from "solid-js";

type SteamAvatarProps = {
  avatarHash: string;
  alt?: string;
  class?: string;
  style?: string | JSX.CSSProperties;
};

export default function SteamAvatar(props: SteamAvatarProps) {
  const smallUrl = `https://avatars.cloudflare.steamstatic.com/${props.avatarHash}.jpg`;
  const fullUrl = `https://avatars.cloudflare.steamstatic.com/${props.avatarHash}_full.jpg`;

  const [src, setSrc] = createSignal(smallUrl);

  onMount(() => {
    const img = new Image();
    img.src = fullUrl;
    img.onload = () => setSrc(fullUrl);
  });

  return (
    <img
      src={src()}
      alt={props.alt ?? "Steam Avatar"}
      class={props.class}
      style={{
        "height": "100%",
        "width": "100%",
        "object-fit": "cover",
        ...typeof props.style === "string" ? {} : props.style,
      }}
    />
  );
}
