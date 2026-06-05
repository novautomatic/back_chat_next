-- ============================================================================
--  SEED: convertir tu usuario en SUPER ADMIN
--  Pasos:
--   1) Crea el usuario en Supabase Studio > Authentication > Users > Add user
--      (email: pbezama@crecetec.com, define una contraseña).
--   2) Ejecuta esto en SQL Editor para promoverlo a super_admin.
-- ============================================================================
update public.perfiles
set rol = 'super_admin', client_id = null, nombre = 'Pedro (Super Admin)'
where email = 'pbezama@crecetec.com';

-- Verificar:
-- select id, email, rol, client_id from public.perfiles;

-- ============================================================================
--  STORAGE: crear el bucket para archivos de conocimiento
--  (o crearlo desde Studio > Storage > New bucket, nombre: "conocimiento", privado)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('conocimiento', 'conocimiento', false)
on conflict (id) do nothing;
