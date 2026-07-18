-- Enable Supabase Realtime for loan_index and payment_index tables
alter publication supabase_realtime add table loan_index;
alter publication supabase_realtime add table payment_index;
