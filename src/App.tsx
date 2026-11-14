import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { api, setUnauthorizedHandler } from "./lib/api";
import { ItemsProvider } from "./lib/items";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Closet from "./pages/Closet";
import ItemEdit from "./pages/ItemEdit";
import Outfits from "./pages/Outfits";
import OutfitDetail from "./pages/OutfitDetail";
import Inspirations from "./pages/Inspirations";
import InspirationDetail from "./pages/InspirationDetail";
import Wishlist from "./pages/Wishlist";
import WishDetail from "./pages/WishDetail";
import Settings from "./pages/Settings";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api("/auth/me")
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null)
    return (
      <div className="grid min-h-dvh place-items-center text-muted">
        <Spinner />
      </div>
    );
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  return (
    <ItemsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Today />} />
            <Route path="closet" element={<Closet />} />
            <Route path="closet/new" element={<ItemEdit />} />
            <Route path="closet/:id" element={<ItemEdit />} />
            <Route path="outfits" element={<Outfits />} />
            <Route path="outfits/:id" element={<OutfitDetail />} />
            <Route path="inspo" element={<Inspirations />} />
            <Route path="inspo/:id" element={<InspirationDetail />} />
            <Route path="wishlist" element={<Wishlist />} />
            <Route path="wishlist/:id" element={<WishDetail />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Today />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ItemsProvider>
  );
}
