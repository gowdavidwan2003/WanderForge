export default function LoadingSpinner({ size = 40, color }) {
  return (
    <>
      <div className="wf-spinner" style={{ width: size, height: size }}>
        <svg viewBox="0 0 50 50" className="wf-spinner__svg">
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke={color || 'var(--color-primary)'}
            strokeWidth="3"
            strokeLinecap="round"
            className="wf-spinner__circle"
          />
        </svg>
        <div className="wf-spinner__compass">✦</div>
      </div>

      <style jsx>{`
        .wf-spinner {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .wf-spinner__svg {
          animation: spin 1.2s linear infinite;
          width: 100%;
          height: 100%;
        }

        .wf-spinner__circle {
          stroke-dasharray: 80, 200;
          stroke-dashoffset: 0;
          animation: dash 1.5s ease-in-out infinite;
        }

        .wf-spinner__compass {
          position: absolute;
          font-size: ${size * 0.3}px;
          color: var(--color-primary);
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes dash {
          0% {
            stroke-dasharray: 1, 200;
            stroke-dashoffset: 0;
          }
          50% {
            stroke-dasharray: 89, 200;
            stroke-dashoffset: -35;
          }
          100% {
            stroke-dasharray: 89, 200;
            stroke-dashoffset: -124;
          }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
