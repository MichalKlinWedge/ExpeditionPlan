-- Pozycja budżetu może dotyczyć tylko części osób. NULL = wszyscy uczestnicy wyjazdu, także dodani później.
alter table public.budget_lines add column participant_ids uuid[];
