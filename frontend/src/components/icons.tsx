import type { SVGProps } from 'react';

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <g>
        <circle cx="12" cy="12" r="1.5"></circle>
        <path d="M12,2.5A9.5,9.5 0 1,1 2.5,12"></path>
        <path d="M21.5,12A9.5,9.5 0 1,1 12,2.5"></path>
        <path d="M4.6,4.6A9.5,9.5 0 1,1 12,21.5"></path>
        <path d="M19.4,19.4A9.5,9.5 0 1,1 12,2.5"></path>
      </g>
    </svg>
  );
}
