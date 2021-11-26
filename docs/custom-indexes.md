# Custom Indexes
As of v5.2 users can create custom indexes. This is done by creating a record of type `Index`, setting `dataKey` to be the name of the field that will be indexed, and setting `dataType` to the name or id of the type that will be indexed.  Setting `dataType` is not required but is recommended.   

An index only applies to data that is in the same group as it.  If `dataType` is set then only data of that type _and_ in the same group as the index will be targeted. If `dataType` is not set _all_ data in the group will be indexed by `dataKey`.

Here is an example index:
```
{
  type: "Index",
  dataType: "Person",
  dataKey: "name"
}
```
Note that this is not showing the fields `id`, `group`, `owner`, `modified`, `signer`, and `signature` which are required on _all_ data.  To generate the above index with all required fields you can use:
```javascript
const ix = newData({ 
  type: 'Index', 
  dataType: 'Person', 
  dataKey: 'name' 
});
signObject(ix);
```
both functions `newData` and `signObject` are found in the `user` module of peerstack.