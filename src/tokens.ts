export const tokens = {
  glass: {
    paneFill: 'rgba(54, 66, 70, 0.34)',
    cardFill: 'rgba(52, 65, 70, 0.28)',
    strongFill: 'rgba(255, 255, 255, 0.2)',
    border: 'rgba(255, 255, 255, 0.3)',
    borderStrong: 'rgba(255, 255, 255, 0.5)',
    shadow: 'rgba(0, 0, 0, 0.44)'
  },
  color: {
    text: '#f6fbff',
    muted: 'rgba(246, 251, 255, 0.72)',
    faint: 'rgba(246, 251, 255, 0.52)',
    cyan: '#5bdce3',
    red: '#ff5d67',
    green: '#34e28b'
  },
  radius: {
    pane: '24px',
    card: '18px',
    pill: '999px'
  },
  blur: {
    pane: '0px',
    card: '16px'
  }
} as const;
