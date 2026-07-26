import { memo } from 'react';

function TitleBarComponent() {
  return <header className='titlebar' aria-label='Barra de título' />;
}

export const TitleBar = memo(TitleBarComponent);
