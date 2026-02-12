import type { SVGProps } from "react";

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width="1em"
      height="1em"
      {...props}
    >
      <g fill="currentColor">
        <path d="M 128,32 48,64 v 128 l 80,32 80,-32 V 64 Z M 128,47.5 192,71.5 V 112 L 128,128 64,112 V 71.5 Z M 56,74.5 128,102.5 200,74.5 v 40.6 l -72,28.8 -72,-28.8 Z m 72,128.5 -64,-25.6 v -42.8 l 64,25.6 z m 8,-2 l 64,-25.6 v -42.8 l -64,25.6 z" />
      </g>
    </svg>
  );
}
