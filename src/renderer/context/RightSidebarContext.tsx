import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface RightSidebarState {
  content: ReactNode;
  collapsed: boolean;
}

interface RightSidebarContextValue {
  state: RightSidebarState;
  setState: (state: RightSidebarState) => void;
}

const RightSidebarContext = createContext<RightSidebarContextValue | null>(null);

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RightSidebarState>({ content: null, collapsed: false });
  return (
    <RightSidebarContext.Provider value={{ state, setState }}>{children}</RightSidebarContext.Provider>
  );
}

export function useRightSidebarState(): RightSidebarState {
  const ctx = useContext(RightSidebarContext);
  return ctx?.state ?? { content: null, collapsed: false };
}

/** Pages call this to project content into the persistent right-hand nav rail. */
export function useSetRightSidebar(content: ReactNode, collapsed: boolean) {
  const ctx = useContext(RightSidebarContext);
  useEffect(() => {
    ctx?.setState({ content, collapsed });
    return () => ctx?.setState({ content: null, collapsed: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, collapsed]);
}
