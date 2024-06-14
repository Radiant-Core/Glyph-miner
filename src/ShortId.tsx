export default function ShortId({ id }: { id: string }) {
  return (
    <>
      {id.substring(0, 4)}&middot;{id.substring(id.length - 4)}
    </>
  );
}
