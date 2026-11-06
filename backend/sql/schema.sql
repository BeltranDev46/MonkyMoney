-- Esquema PostgreSQL con soporte multi-usuario y Row Level Security (Supabase / Neon)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración segura por si la tabla ya existía antes de agregar Auth
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS owner_id UUID;

CREATE TABLE IF NOT EXISTS public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('expense', 'settlement')),
  description TEXT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_by UUID REFERENCES public.members(id) ON DELETE CASCADE,
  split_mode TEXT CHECK (split_mode IN ('equal', 'exact')),
  from_member_id UUID REFERENCES public.members(id) ON DELETE CASCADE,
  to_member_id UUID REFERENCES public.members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transaction_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0)
);

-- Índices en todas las llaves foráneas y columnas usadas por RLS (Postgres Best Practices)
CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON public.groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_members_group_id ON public.members(group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_group_id ON public.transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_paid_by ON public.transactions(paid_by);
CREATE INDEX IF NOT EXISTS idx_transactions_from_member ON public.transactions(from_member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to_member ON public.transactions(to_member_id);
CREATE INDEX IF NOT EXISTS idx_splits_transaction_id ON public.transaction_splits(transaction_id);
CREATE INDEX IF NOT EXISTS idx_splits_member_id ON public.transaction_splits(member_id);

-- Habilitar Row Level Security en todas las tablas del esquema public
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_splits ENABLE ROW LEVEL SECURITY;

-- Si estamos en Supabase (esquema auth y rol authenticated disponibles), vinculamos FK a auth.users y creamos políticas RLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN

    -- Llave foránea hacia auth.users si aún no existe
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'groups_owner_id_fkey'
    ) THEN
      ALTER TABLE public.groups
        ADD CONSTRAINT groups_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- Políticas para public.groups
    DROP POLICY IF EXISTS groups_select_own ON public.groups;
    CREATE POLICY groups_select_own ON public.groups
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) = owner_id);

    DROP POLICY IF EXISTS groups_insert_own ON public.groups;
    CREATE POLICY groups_insert_own ON public.groups
      FOR INSERT TO authenticated
      WITH CHECK ((SELECT auth.uid()) = owner_id);

    DROP POLICY IF EXISTS groups_update_own ON public.groups;
    CREATE POLICY groups_update_own ON public.groups
      FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) = owner_id)
      WITH CHECK ((SELECT auth.uid()) = owner_id);

    DROP POLICY IF EXISTS groups_delete_own ON public.groups;
    CREATE POLICY groups_delete_own ON public.groups
      FOR DELETE TO authenticated
      USING ((SELECT auth.uid()) = owner_id);

    -- Políticas para public.members (pertenecen a un grupo del usuario autenticado)
    DROP POLICY IF EXISTS members_select_own ON public.members;
    CREATE POLICY members_select_own ON public.members
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS members_insert_own ON public.members;
    CREATE POLICY members_insert_own ON public.members
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS members_update_own ON public.members;
    CREATE POLICY members_update_own ON public.members
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS members_delete_own ON public.members;
    CREATE POLICY members_delete_own ON public.members
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    -- Políticas para public.transactions
    DROP POLICY IF EXISTS transactions_select_own ON public.transactions;
    CREATE POLICY transactions_select_own ON public.transactions
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS transactions_insert_own ON public.transactions;
    CREATE POLICY transactions_insert_own ON public.transactions
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS transactions_update_own ON public.transactions;
    CREATE POLICY transactions_update_own ON public.transactions
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS transactions_delete_own ON public.transactions;
    CREATE POLICY transactions_delete_own ON public.transactions
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = group_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    -- Políticas para public.transaction_splits
    DROP POLICY IF EXISTS splits_select_own ON public.transaction_splits;
    CREATE POLICY splits_select_own ON public.transaction_splits
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.transactions t
          JOIN public.groups g ON g.id = t.group_id
          WHERE t.id = transaction_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS splits_insert_own ON public.transaction_splits;
    CREATE POLICY splits_insert_own ON public.transaction_splits
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.transactions t
          JOIN public.groups g ON g.id = t.group_id
          WHERE t.id = transaction_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS splits_update_own ON public.transaction_splits;
    CREATE POLICY splits_update_own ON public.transaction_splits
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.transactions t
          JOIN public.groups g ON g.id = t.group_id
          WHERE t.id = transaction_id AND g.owner_id = (SELECT auth.uid())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.transactions t
          JOIN public.groups g ON g.id = t.group_id
          WHERE t.id = transaction_id AND g.owner_id = (SELECT auth.uid())
        )
      );

    DROP POLICY IF EXISTS splits_delete_own ON public.transaction_splits;
    CREATE POLICY splits_delete_own ON public.transaction_splits
      FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.transactions t
          JOIN public.groups g ON g.id = t.group_id
          WHERE t.id = transaction_id AND g.owner_id = (SELECT auth.uid())
        )
      );

  END IF;
END $$;
